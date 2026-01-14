/**
 * Commit display utilities
 */

import chalk from 'chalk';
import type { Commit } from '../types/commit.js';

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
 * Display input size information
 */
export function displayInputSize(treeSize: number, diffSize: number, totalSize: number): void {
  console.log(chalk.dim(`  Tree summary: ${treeSize} bytes`));
  if (diffSize > 0) {
    console.log(chalk.dim(`  Diff content: ${diffSize} bytes`));
  } else {
    console.log(chalk.dim(`  Diff content: skipped (tree too large)`));
  }
  console.log(chalk.green(`Total input size: ${totalSize} bytes`));
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
