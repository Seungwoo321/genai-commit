/**
 * Git diff extraction with size limits
 */

import { getGit, hasCommits } from './status.js';
import type { DiffOptions } from '../types/git.js';

const DEFAULT_OPTIONS: DiffOptions = {
  maxInputSize: 30000,
  maxDiffSize: 15000,
};

/**
 * Get diff for modified files with size limit
 */
export async function getModifiedDiffs(
  maxSize: number,
  cwd?: string
): Promise<string> {
  const git = getGit(cwd);
  const hasExistingCommits = await hasCommits(cwd);
  const diffRef = hasExistingCommits ? ['HEAD'] : ['--cached'];

  // Use --name-only to get accurate file paths (handles renames correctly)
  const nameOnly = await git.raw(['diff', '--name-only', ...diffRef]);
  const modifiedFiles = nameOnly.trim().split('\n').filter(Boolean);

  if (modifiedFiles.length === 0) {
    return '';
  }

  let output = `\n=== MODIFIED FILE DIFFS (${modifiedFiles.length} files) ===`;
  let currentSize = output.length;

  for (const file of modifiedFiles) {
    try {
      const fileDiff = await git.diff([...diffRef, '--', file]);
      const diffSize = fileDiff.length;

      if (currentSize + diffSize + 100 > maxSize) {
        const remaining = modifiedFiles.length - modifiedFiles.indexOf(file);
        output += `\n\n[... ${remaining} more files truncated due to size limit]`;
        break;
      }

      if (fileDiff) {
        output += `\n\n--- ${file} ---\n${fileDiff}`;
        currentSize += diffSize + file.length + 10;
      }
    } catch {
      // Skip files that can't be diffed (e.g. deleted files)
    }
  }

  return output;
}

/**
 * Get complete diff content with tree summary
 */
export async function getDiffContent(
  treeSummary: string,
  options: Partial<DiffOptions> = {},
  cwd?: string
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const treeSize = treeSummary.length;
  const remainingSize = opts.maxInputSize - treeSize - 500;

  let diffContent = '';

  if (remainingSize > 1000) {
    const maxDiff = Math.min(remainingSize, opts.maxDiffSize);
    diffContent = await getModifiedDiffs(maxDiff, cwd);
  }

  return diffContent;
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
