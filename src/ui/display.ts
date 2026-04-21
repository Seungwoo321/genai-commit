/**
 * Commit display utilities
 */

import chalk from 'chalk';
import type { Commit } from '../types/commit.js';
import { logger } from '../utils/logger.js';

/**
 * Display proposed commits in a formatted way
 */
export function displayCommits(commits: Commit[]): void {
  console.log(`\n${chalk.green('=== Proposed Commits ===')}\n`);

  commits.forEach((commit, i) => {
    console.log(`${chalk.cyan(`[${i + 1}]`)} ${chalk.green(commit.title)}`);
    console.log(`    Files: ${commit.files.join(', ')}`);
    console.log(`    Message: ${commit.message}`);
    if (commit.jiraKey) {
      console.log(`    ${chalk.magenta(`Jira: ${commit.jiraKey}`)}`);
    }
    console.log('');
  });
}

/**
 * Display commit generation progress
 */
export function displayProgress(step: number, total: number, message: string): void {
  console.log(chalk.cyan(`[${step}/${total}] ${message}`));
}

/**
 * Display analysis start message
 */
export function displayAnalysisStart(branch: string, model?: string): void {
  console.log(chalk.green(`Analyzing changes on branch: ${chalk.cyan(branch)}`));
  if (model) {
    console.log(chalk.cyan(`Using model: ${model}`));
  }
}

function printList(files: string[]): void {
  for (const file of files) {
    console.log(`  - ${file}`);
  }
}

/**
 * Report file entries that did not resolve to any real changed file.
 */
export function reportDropped(dropped: string[]): void {
  if (dropped.length === 0) return;
  logger.warning(
    `${dropped.length} invalid file entry(ies) dropped from AI output:`
  );
  printList(dropped);
}

/**
 * Report files that appeared in more than one commit (first-commit-wins).
 */
export function reportDuplicates(duplicates: string[]): void {
  if (duplicates.length === 0) return;
  logger.warning(
    `${duplicates.length} file(s) appeared in multiple commits; kept in the first:`
  );
  printList(duplicates);
}

/**
 * Report changed files that no commit claimed ownership of. Always produces
 * an error-level message because the commit flow must be blocked.
 */
export function reportMissing(missing: string[]): void {
  if (missing.length === 0) return;
  logger.error(
    `${missing.length} changed file(s) not assigned to any commit:`
  );
  printList(missing);
}
