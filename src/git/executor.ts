/**
 * Git commit execution
 */

import { getGit, resetStaging } from './status.js';
import type { Commit } from '../types/commit.js';
import { logger, colors } from '../utils/logger.js';

/**
 * Stage files for commit
 * Uses `git add -A -- <files>` which handles all cases:
 * new, modified, deleted, and renamed files
 */
export async function stageFiles(files: string[], cwd?: string): Promise<void> {
  const git = getGit(cwd);

  try {
    await git.raw(['add', '-A', '--', ...files]);
  } catch (error) {
    logger.warning(`Failed to stage files: ${error}`);
  }
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
    await stageFiles(commit.files, cwd);

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
