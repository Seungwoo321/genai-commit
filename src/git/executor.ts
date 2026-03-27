/**
 * Git commit execution
 */

import { getGit, resetStaging } from './status.js';
import type { Commit } from '../types/commit.js';
import { logger, colors } from '../utils/logger.js';

/**
 * Get set of deleted files from current git status
 */
async function getDeletedFiles(git: ReturnType<typeof getGit>): Promise<Set<string>> {
  const status = await git.status();
  return new Set(status.deleted);
}

/**
 * Stage files for commit
 * Uses `git rm --cached` for deleted files, `git add -A` for the rest
 */
export async function stageFiles(files: string[], cwd?: string): Promise<void> {
  const git = getGit(cwd);
  const deletedFiles = await getDeletedFiles(git);

  for (const file of files) {
    try {
      if (deletedFiles.has(file)) {
        await git.raw(['rm', '--cached', '--', file]);
      } else {
        await git.raw(['add', '-A', '--', file]);
      }
    } catch (error) {
      logger.warning(`Failed to stage file: ${file} - ${error instanceof Error ? error.message : error}`);
    }
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
