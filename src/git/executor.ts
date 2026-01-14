/**
 * Git commit execution
 */

import { getGit } from './status.js';
import type { Commit } from '../types/commit.js';
import { logger, colors } from '../utils/logger.js';
import fs from 'fs';

/**
 * Stage files for commit
 */
export async function stageFiles(files: string[], cwd?: string): Promise<void> {
  const git = getGit(cwd);

  for (const file of files) {
    try {
      // Check if file exists
      if (fs.existsSync(file)) {
        await git.add(file);
      } else {
        // File might be deleted, try to stage the deletion
        try {
          await git.rm(file);
        } catch {
          // If rm fails, try add with update flag
          await git.add(['-A', file]);
        }
      }
    } catch (error) {
      logger.warning(`Failed to stage file: ${file}`);
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
