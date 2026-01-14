/**
 * Git status collection
 */

import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import type { GitChange, GitStats } from '../types/git.js';

let gitInstance: SimpleGit | null = null;

/**
 * Get or create simple-git instance
 */
export function getGit(cwd?: string): SimpleGit {
  if (!gitInstance || cwd) {
    gitInstance = simpleGit(cwd);
  }
  return gitInstance;
}

/**
 * Check if current directory is a git repository
 */
export async function isGitRepository(cwd?: string): Promise<boolean> {
  try {
    const git = getGit(cwd);
    await git.revparse(['--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  const git = getGit(cwd);
  const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
  return branch.trim();
}

/**
 * Get git status and convert to our format
 */
export async function getGitStatus(cwd?: string): Promise<{
  changes: GitChange[];
  stats: GitStats;
}> {
  const git = getGit(cwd);
  const status: StatusResult = await git.status();

  const changes: GitChange[] = [];
  const stats: GitStats = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    total: 0,
  };

  // Staged files
  for (const file of status.created) {
    changes.push({ file, status: 'A' });
    stats.added++;
  }

  for (const file of status.modified) {
    changes.push({ file, status: 'M' });
    stats.modified++;
  }

  for (const file of status.deleted) {
    changes.push({ file, status: 'D' });
    stats.deleted++;
  }

  for (const file of status.renamed) {
    changes.push({ file: file.to, status: 'R' });
    stats.renamed++;
  }

  // Unstaged modified files
  for (const file of status.not_added) {
    if (!changes.some((c) => c.file === file)) {
      changes.push({ file, status: 'M' });
      stats.modified++;
    }
  }

  // Untracked files
  for (const file of status.files) {
    if (file.index === '?' && file.working_dir === '?') {
      changes.push({ file: file.path, status: '?' });
      stats.untracked++;
    }
  }

  stats.total = stats.added + stats.modified + stats.deleted + stats.renamed + stats.untracked;

  return { changes, stats };
}

/**
 * Get all valid changed files (for validation)
 */
export async function getAllChangedFiles(cwd?: string): Promise<Set<string>> {
  const { changes } = await getGitStatus(cwd);
  return new Set(changes.map((c) => c.file));
}

/**
 * Check if there are any changes to commit
 */
export async function hasChanges(cwd?: string): Promise<boolean> {
  const { stats } = await getGitStatus(cwd);
  return stats.total > 0;
}
