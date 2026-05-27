/**
 * Git commit execution
 */

import { getGit, resetStaging } from './status.js';
import type { Commit } from '../types/commit.js';
import { logger, colors } from '../utils/logger.js';

/**
 * Check if a path is ignored by .gitignore
 * Note: simple-git treats non-zero exit as error only when stderr is non-empty.
 * `git check-ignore -q` suppresses stderr, so we use non-quiet mode
 * and check if there's output (output = ignored, no output = not ignored).
 */
async function isIgnored(git: ReturnType<typeof getGit>, file: string): Promise<boolean> {
  try {
    const result = await git.raw(['check-ignore', '--no-index', file]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export interface StageResult {
  staged: number;
  failed: number;
}

/**
 * Stage files for commit.
 * - .gitignore'd paths: `git rm -r --cached --ignore-unmatch` so new files
 *   that happen to match an ignore rule are no-ops instead of hard errors.
 * - Everything else: `git add -A`.
 * Returns counts so the caller can decide whether to abort.
 */
export async function stageFiles(files: string[], cwd?: string): Promise<StageResult> {
  const git = getGit(cwd);
  let staged = 0;
  let failed = 0;

  for (const file of files) {
    try {
      if (await isIgnored(git, file)) {
        await git.raw(['rm', '-r', '--cached', '--ignore-unmatch', '--', file]);
      } else {
        await git.raw(['add', '-A', '--', file]);
      }
      staged++;
    } catch (error) {
      failed++;
      logger.warning(`Failed to stage file: ${file} - ${error instanceof Error ? error.message : error}`);
    }
  }

  return { staged, failed };
}

/**
 * Return the list of files actually staged in the index.
 */
async function getStagedFiles(git: ReturnType<typeof getGit>): Promise<string[]> {
  const result = await git.raw(['diff', '--cached', '--name-only']);
  return result.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Categorizes why a single commit attempt failed so the interactive loop can
 * show an actionable message instead of just silently re-prompting.
 *
 *  - `hook`    : `git commit` was rejected by a pre-commit hook (husky /
 *                lint-staged / any custom hook). The hook's own stderr was
 *                already shown to the user; the loop will offer a retry after
 *                they fix the reported issues in their editor.
 *  - `staging` : nothing was staged (every file in the commit was missing,
 *                deleted, or otherwise unavailable). Retrying with the same
 *                commit can't succeed.
 *  - `unknown` : `git commit` threw for a non-hook reason (config error,
 *                signing failure, ...). The raw error is surfaced verbatim.
 */
export type CommitFailureKind = 'hook' | 'staging' | 'unknown';

export interface CommitFailure {
  /** 0-based index of the failing commit within the input array. */
  index: number;
  kind: CommitFailureKind;
  /** Human-readable error message (already logged to the terminal). */
  message: string;
}

export interface ExecuteResult {
  ok: boolean;
  /** Commits that landed before stopping. `ok === true` ⇒ `commits.length`. */
  successCount: number;
  /** Present iff `ok === false`. */
  failure?: CommitFailure;
}

/**
 * Markers we look for in simple-git's `commit` error message to recognize a
 * pre-commit hook rejection. simple-git surfaces git's stderr verbatim, so
 * for husky/lint-staged failures these strings are reliably present (husky
 * prints "husky - pre-commit hook failed" on rejection; lint-staged prints
 * its own banner). A false positive only changes the recovery message we
 * show alongside the same retry capability, so the heuristic is safe.
 */
const HOOK_FAILURE_MARKERS = [
  'husky',
  'pre-commit',
  'lint-staged',
  'hook failed',
];

function isLikelyHookFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return HOOK_FAILURE_MARKERS.some((needle) => lower.includes(needle));
}

interface SingleCommitResult {
  ok: boolean;
  failure?: { kind: CommitFailureKind; message: string };
}

/**
 * Stage and commit one entry, returning a categorized result. The boolean
 * `executeCommit` below is the back-compat shim for callers (and unit tests)
 * that only need a yes/no answer; the interactive loop uses this helper
 * directly so it can react to *why* a commit failed.
 */
async function tryStageAndCommit(
  commit: Commit,
  cwd?: string
): Promise<SingleCommitResult> {
  const git = getGit(cwd);

  try {
    // Prepare title with Jira key if present
    let title = commit.title;
    if (commit.jiraKey && !title.includes(`(${commit.jiraKey})`)) {
      title = `${title} (${commit.jiraKey})`;
    }

    // Reset staging area to ensure only intended files are committed
    await resetStaging(cwd);

    // Stage files
    logger.info('Staging files...');
    const { failed } = await stageFiles(commit.files, cwd);

    // simple-git does not throw when the index is empty, so `git commit`
    // would silently no-op. Verify something was actually staged.
    const stagedFiles = await getStagedFiles(git);
    if (stagedFiles.length === 0) {
      const message = `No files were staged (${failed}/${commit.files.length} failed).`;
      logger.error(`${message} Aborting commit.`);
      return { ok: false, failure: { kind: 'staging', message } };
    }

    if (failed > 0) {
      logger.warning(
        `${failed} file(s) failed to stage; continuing with ${stagedFiles.length} staged file(s).`
      );
    }

    // Execute commit. A throw here is almost always a pre-commit hook
    // rejecting the change (eslint --fix found an error, tests failed, etc.);
    // categorize so the loop can guide the user toward the editor instead of
    // looping on the same dead state.
    logger.success(`Committing: ${title}`);
    try {
      await git.commit([title, commit.message]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind: CommitFailureKind = isLikelyHookFailure(message)
        ? 'hook'
        : 'unknown';
      logger.error(
        kind === 'hook'
          ? 'Commit rejected by pre-commit hook (see hook output above).'
          : `Commit failed: ${message}`
      );
      return { ok: false, failure: { kind, message } };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Commit failed: ${message}`);
    return { ok: false, failure: { kind: 'unknown', message } };
  }
}

/**
 * Execute a single commit. Returns `true` iff it landed.
 *
 * Back-compat wrapper around `tryStageAndCommit` for direct callers and
 * tests; the multi-commit `executeCommits` returns the richer
 * `ExecuteResult` because the loop needs to know *why* it stopped and which
 * commits already landed.
 */
export async function executeCommit(
  commit: Commit,
  cwd?: string
): Promise<boolean> {
  const result = await tryStageAndCommit(commit, cwd);
  return result.ok;
}

/**
 * Execute the commit list in order, stopping at the first failure.
 *
 * Returns the index of the first failure and the count of commits that
 * landed before it, so a caller (the interactive loop) can offer a retry
 * that picks up from the failed commit instead of restarting from commit 0
 * — which would silently fail on the already-landed prefix because their
 * files have nothing left to stage.
 */
export async function executeCommits(
  commits: Commit[],
  cwd?: string
): Promise<ExecuteResult> {
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    console.log(colors.yellow(`\nStaging files for commit ${i + 1}/${commits.length}...`));

    const result = await tryStageAndCommit(commit, cwd);
    if (!result.ok) {
      logger.error(`Stopped at commit ${i + 1}/${commits.length}.`);
      return {
        ok: false,
        successCount: i,
        failure: {
          index: i,
          kind: result.failure?.kind ?? 'unknown',
          message: result.failure?.message ?? 'unknown error',
        },
      };
    }

    console.log('');
  }

  logger.success('All commits completed successfully!');
  return { ok: true, successCount: commits.length };
}
