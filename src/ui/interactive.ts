/**
 * Interactive UI for commit selection and actions
 */

import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import type { Commit } from '../types/commit.js';
import type { AIProvider } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import type { GitDiffResult } from '../types/git.js';
import { displayCommits } from './display.js';
import { executeCommits } from '../git/executor.js';
import { processJiraTickets } from '../jira/merger.js';
import { logger } from '../utils/logger.js';

export type UserAction = 'commit' | 'cancel' | 'feedback' | 'jira';

/**
 * Prompt user to select an action
 */
async function promptAction(): Promise<UserAction> {
  const { action } = await inquirer.prompt<{ action: UserAction }>([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { value: 'commit', name: `${chalk.yellow('[y]')} Commit all` },
        { value: 'cancel', name: `${chalk.yellow('[n]')} Cancel` },
        { value: 'feedback', name: `${chalk.yellow('[f]')} Provide feedback` },
        { value: 'jira', name: `${chalk.yellow('[t]')} Assign Jira tickets` },
      ],
    },
  ]);

  return action;
}

/**
 * Prompt user for feedback
 */
async function promptFeedback(): Promise<string> {
  const { feedback } = await inquirer.prompt<{ feedback: string }>([
    {
      type: 'input',
      name: 'feedback',
      message: 'feedback>',
    },
  ]);

  return feedback;
}

/**
 * Regenerate commits with feedback
 */
async function regenerateWithFeedback(
  provider: AIProvider,
  previousResponse: string,
  feedback: string,
  config: GencoConfig
): Promise<Commit[]> {
  const feedbackInput = `Previous response:
${previousResponse}

User feedback: ${feedback}

Please regenerate commit messages based on the feedback.`;

  const response = await provider.generate(feedbackInput, 'commit');
  const result = provider.parseResponse(response);

  return result.commits;
}

/**
 * Main interactive loop
 */
export async function runInteractiveLoop(
  provider: AIProvider,
  initialCommits: Commit[],
  initialResponse: string,
  gitResult: GitDiffResult,
  config: GencoConfig
): Promise<void> {
  let commits = initialCommits;
  let lastResponse = initialResponse;

  while (true) {
    displayCommits(commits);

    console.log(
      `${chalk.yellow('[y]')} Commit all  ` +
      `${chalk.yellow('[n]')} Cancel  ` +
      `${chalk.yellow('[f]')} Feedback  ` +
      `${chalk.yellow('[t]')} Assign Jira tickets`
    );

    const action = await promptAction();

    switch (action) {
      case 'commit':
        const success = await executeCommits(commits);
        if (success) {
          return;
        }
        break;

      case 'cancel':
        logger.warning('Cancelled');
        return;

      case 'feedback':
        const feedback = await promptFeedback();

        if (!feedback.trim()) {
          logger.warning('Empty feedback, skipping...');
          continue;
        }

        const spinner = ora('Sending feedback to agent...').start();

        try {
          commits = await regenerateWithFeedback(
            provider,
            lastResponse,
            feedback,
            config
          );
          spinner.succeed('Regenerated');
        } catch (error) {
          spinner.fail('Failed to regenerate');
          logger.error(String(error));
        }
        break;

      case 'jira':
        try {
          commits = await processJiraTickets(commits, provider, config);
        } catch (error) {
          logger.error(`Failed to process Jira tickets: ${error}`);
        }
        break;
    }
  }
}

/**
 * Simple yes/no confirmation
 */
export async function confirm(message: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: false,
    },
  ]);

  return confirmed;
}
