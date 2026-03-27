/**
 * Git status collection
 */

import simpleGit, { SimpleGit, StatusResult } from 'simple-git';
import type { GitChange, GitStats } from '../types/git.js';
import { logger } from '../utils/logger.js';

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
  try {
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    return branch.trim();
  } catch {
    // No commits yet - HEAD doesn't exist
    try {
      // Get branch name from symbolic ref (works even without commits)
      const ref = await git.raw(['symbolic-ref', '--short', 'HEAD']);
      return ref.trim();
    } catch {
      return 'main';
    }
  }
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
    changes.push({ file: file.to, status: 'R', from: file.from });
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
  const files = new Set<string>();
  for (const c of changes) {
    files.add(c.file);
    if (c.from) {
      files.add(c.from);
    }
  }
  return files;
}

/**
 * Check if there are any commits in the repository
 */
export async function hasCommits(cwd?: string): Promise<boolean> {
  const git = getGit(cwd);
  try {
    await git.revparse(['HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if there are any changes to commit
 */
export async function hasChanges(cwd?: string): Promise<boolean> {
  const { stats } = await getGitStatus(cwd);
  return stats.total > 0;
}

export interface RemoteStatus {
  hasRemote: boolean;
  behind: number;
  ahead: number;
  needsPull: boolean;
  needsPush: boolean;
  diverged: boolean;
}

/**
 * Stage all changes (git add -A)
 */
export async function stageAllChanges(cwd?: string): Promise<void> {
  const git = getGit(cwd);
  await git.add(['-A']);
}

/**
 * Reset staging area
 * Uses `git reset HEAD` for repos with commits,
 * `git rm -r --cached .` for new repos without commits.
 */
export async function resetStaging(cwd?: string): Promise<void> {
  const git = getGit(cwd);
  if (await hasCommits(cwd)) {
    await git.reset(['HEAD']);
  } else {
    try {
      await git.raw(['rm', '-r', '--cached', '.']);
    } catch {
      // Ignore if index is already empty
    }
  }
}

/**
 * Check remote tracking branch status
 * Returns info about whether local is behind/ahead of remote
 */
export async function getRemoteStatus(cwd?: string): Promise<RemoteStatus> {
  const git = getGit(cwd);
  const defaultStatus: RemoteStatus = {
    hasRemote: false,
    behind: 0,
    ahead: 0,
    needsPull: false,
    needsPush: false,
    diverged: false,
  };

  try {
    // Fetch latest from remote (silently)
    try {
      await git.fetch(['--quiet']);
    } catch {
      logger.warning('Failed to fetch from remote. Skipping remote status check.');
      return defaultStatus;
    }

    // Get current branch
    const branch = await getCurrentBranch(cwd);

    // Check if there's a remote tracking branch
    let upstream: string;
    try {
      const result = await git.raw(['rev-parse', '--abbrev-ref', `${branch}@{upstream}`]);
      upstream = result.trim();
    } catch {
      // No upstream branch configured
      return defaultStatus;
    }

    if (!upstream) {
      return defaultStatus;
    }

    // Get ahead/behind counts
    const revList = await git.raw(['rev-list', '--left-right', '--count', `${branch}...${upstream}`]);
    const [ahead, behind] = revList.trim().split(/\s+/).map(Number);

    return {
      hasRemote: true,
      behind: behind || 0,
      ahead: ahead || 0,
      needsPull: behind > 0,
      needsPush: ahead > 0,
      diverged: ahead > 0 && behind > 0,
    };
  } catch {
    // If anything fails, return default (no remote info)
    return defaultStatus;
  }
}
