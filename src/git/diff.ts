/**
 * Git diff extraction with size limits.
 *
 * The chunked multi-pass commit flow (`planChunks` + `generate`) needs both
 * the full per-file diff text (to feed the AI) and the per-file byte size
 * (to decide chunk boundaries) without re-shelling once per file. The bulk
 * loader runs `git diff` exactly once and parses the output by `diff --git`
 * markers; downstream callers consume the resulting Map directly.
 *
 * `getDiffContent` / `getModifiedDiffs` remain as the legacy single-call
 * surface re-exported from `index.ts`, but are now thin wrappers over the
 * loader + formatter so there is one source of truth for diff parsing.
 */

import { getGit, hasCommits } from './status.js';
import type { DiffOptions } from '../types/git.js';

const DEFAULT_OPTIONS: DiffOptions = {
  maxInputSize: 30000,
  maxDiffSize: 15000,
};

/**
 * Load every per-file diff in a single git invocation. Splits the bulk
 * output by `diff --git a/X b/X` markers so each file's diff text is
 * addressable by its post-rename path (the `b/` side, which is the path
 * git operates on for staging and committing).
 *
 * Returns an empty map when there are no tracked diffs (e.g. only untracked
 * files); callers must combine this with the change list rather than relying
 * on the map alone for coverage.
 */
export async function loadFileDiffs(cwd?: string): Promise<Map<string, string>> {
  const git = getGit(cwd);
  const hasExistingCommits = await hasCommits(cwd);
  const diffRef = hasExistingCommits ? ['HEAD'] : ['--cached'];
  const bulk = await git.raw(['diff', ...diffRef]);

  const diffs = new Map<string, string>();
  if (!bulk) return diffs;

  // Split with a lookahead so each `diff --git ...` header stays attached to
  // its body. Filter out the leading empty entry that the lookahead produces
  // when the bulk output starts with the marker.
  const entries = bulk.split(/(?=^diff --git )/m).filter((e) => e.trim());
  const headerRe = /^diff --git a\/.+ b\/(.+)$/m;

  for (const entry of entries) {
    const match = headerRe.exec(entry);
    if (match) {
      diffs.set(match[1], entry);
    }
  }

  return diffs;
}

/**
 * Build the `=== MODIFIED FILE DIFFS (N files) ===` section restricted to
 * the given file list, using a pre-loaded diff map. Files without a diff
 * entry (typically untracked) are skipped silently — they still surface to
 * the AI through the tree summary's "Untracked" section.
 *
 * If the running total would exceed `maxSize`, emits an explicit truncation
 * marker and stops. Truncation here only loses diff DETAIL, never coverage:
 * the affected paths are already declared in the tree summary, so the AI
 * can still produce a commit message even without the body.
 */
export function formatModifiedDiffs(
  files: string[],
  diffs: Map<string, string>,
  maxSize: number
): string {
  const presentFiles = files.filter((f) => diffs.has(f));
  if (presentFiles.length === 0) return '';

  let output = `\n=== MODIFIED FILE DIFFS (${presentFiles.length} files) ===`;
  let currentSize = output.length;

  for (let i = 0; i < presentFiles.length; i++) {
    const file = presentFiles[i];
    const fileDiff = diffs.get(file)!;
    const diffSize = fileDiff.length;

    if (currentSize + diffSize + 100 > maxSize) {
      const remaining = presentFiles.length - i;
      output += `\n\n[... ${remaining} more files truncated due to size limit]`;
      break;
    }

    output += `\n\n--- ${file} ---\n${fileDiff}`;
    currentSize += diffSize + file.length + 10;
  }

  return output;
}

/**
 * Get diff for modified files with size limit.
 *
 * Legacy single-call entry point. Loads all per-file diffs once and formats
 * the section over the full file set. Equivalent in output to the previous
 * implementation but a single git invocation instead of N+1.
 */
export async function getModifiedDiffs(
  maxSize: number,
  cwd?: string
): Promise<string> {
  const diffs = await loadFileDiffs(cwd);
  return formatModifiedDiffs([...diffs.keys()], diffs, maxSize);
}

/**
 * Get complete diff content with tree summary.
 *
 * Reserves headroom for the tree summary and any trailing prose, then asks
 * the formatter to fill the remainder up to `maxDiffSize`. Returns an empty
 * string when the tree alone consumed the input budget.
 */
export async function getDiffContent(
  treeSummary: string,
  options: Partial<DiffOptions> = {},
  cwd?: string
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const treeSize = treeSummary.length;
  const remainingSize = opts.maxInputSize - treeSize - 500;

  if (remainingSize <= 1000) return '';

  const maxDiff = Math.min(remainingSize, opts.maxDiffSize);
  return getModifiedDiffs(maxDiff, cwd);
}

/**
 * Build the diff section for a specific subset of files, using a pre-loaded
 * diff map. Used by the chunked generation path so each chunk's input only
 * carries the diffs for its own files.
 */
export function getDiffContentForFiles(
  treeSummary: string,
  files: string[],
  diffs: Map<string, string>,
  options: Partial<DiffOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const treeSize = treeSummary.length;
  const remainingSize = opts.maxInputSize - treeSize - 500;

  if (remainingSize <= 1000) return '';

  const maxDiff = Math.min(remainingSize, opts.maxDiffSize);
  return formatModifiedDiffs(files, diffs, maxDiff);
}

/**
 * Get git shortstat summary
 */
export async function getShortStat(cwd?: string): Promise<string> {
  const git = getGit(cwd);
  try {
    const hasExistingCommits = await hasCommits(cwd);
    const diffRef = hasExistingCommits ? ['--shortstat', 'HEAD'] : ['--shortstat', '--cached'];
    const result = await git.diff(diffRef);
    return result.trim();
  } catch {
    return '';
  }
}
