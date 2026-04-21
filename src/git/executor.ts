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
 * Execute a single commit
 */
export async function executeCommit(
  commit: Commit,
  cwd?: string
): Promise<boolean> {
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
      logger.error(
        `No files were staged (${failed}/${commit.files.length} failed). Aborting commit.`
      );
      return false;
    }

    if (failed > 0) {
      logger.warning(
        `${failed} file(s) failed to stage; continuing with ${stagedFiles.length} staged file(s).`
      );
    }

    // Execute commit
    logger.success(`Committing: ${title}`);
    await git.commit([title, commit.message]);

    return true;
  } catch (error) {
    logger.error(`Commit failed: ${error}`);
    return false;
  }
}

/**
 * Execute all commits in order
 */
export async function executeCommits(
  commits: Commit[],
  cwd?: string
): Promise<boolean> {
  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    console.log(colors.yellow(`\nStaging files for commit ${i + 1}/${commits.length}...`));

    const success = await executeCommit(commit, cwd);
    if (!success) {
      logger.error('Commit failed. Aborting.');
      return false;
    }

    console.log('');
  }

  logger.success('All commits completed successfully!');
  return true;
}
