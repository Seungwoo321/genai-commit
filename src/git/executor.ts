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
    const result = await git.raw(['check-ignore', file]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Stage files for commit
 * - .gitignore'd paths (tracked but now ignored): git rm -r --cached
 * - Everything else: git add -A
 */
export async function stageFiles(files: string[], cwd?: string): Promise<void> {
  const git = getGit(cwd);

  for (const file of files) {
    try {
      if (await isIgnored(git, file)) {
        await git.raw(['rm', '-r', '--cached', '--', file]);
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
