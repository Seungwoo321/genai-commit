/**
 * Interactive UI for commit selection and actions
 */

import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import type { Commit } from '../types/commit.js';
import type { AIProvider } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import {
  displayCommits,
  reportDropped,
  reportDuplicates,
  reportMissing,
} from './display.js';
import { executeCommits } from '../git/executor.js';
import { processJiraTickets } from '../jira/merger.js';
import { normalizeCommits, validateTitleLength } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

export type UserAction = 'commit' | 'cancel' | 'feedback' | 'jira';

export interface CoverageState {
  missing: string[];
}

/**
 * Upper bound for the previous AI response that gets echoed back in a
 * feedback-regeneration prompt. A large response would otherwise double
 * the payload size and trigger AI timeouts.
 */
const MAX_PREVIOUS_RESPONSE_ECHO = 5000;

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
 * Trim the echoed previous response so the regeneration prompt does not
 * grow unbounded. The head is kept because commit outputs are front-loaded
 * (titles appear first in both JSON and delimiter formats).
 */
function trimPreviousResponse(previous: string): string {
  if (previous.length <= MAX_PREVIOUS_RESPONSE_ECHO) {
    return previous;
  }
  const head = previous.slice(0, MAX_PREVIOUS_RESPONSE_ECHO);
  return `${head}\n[... truncated ${previous.length - MAX_PREVIOUS_RESPONSE_ECHO} bytes of previous response ...]`;
}

/**
 * Regenerate commits with feedback.
 *
 * The original input (tree + diff) is re-sent alongside the previous response
 * and the user's feedback, because the AI does not retain prior context
 * between `generate` calls — without the change list the model would
 * hallucinate paths again. The previous response is trimmed so a large
 * first-round output does not inflate the feedback call into a timeout.
 *
 * The response is re-normalized against the real change list so synthetic or
 * hallucinated paths are filtered out the same way as the initial call.
 */
async function regenerateWithFeedback(
  provider: AIProvider,
  originalInput: string,
  previousResponse: string,
  feedback: string,
  validFiles: Set<string>
): Promise<{
  commits: Commit[];
  missing: string[];
  dropped: string[];
  duplicates: string[];
  raw: string;
}> {
  const feedbackInput = `${originalInput}

=== PREVIOUS RESPONSE ===
${trimPreviousResponse(previousResponse)}

=== USER FEEDBACK ===
${feedback}

Regenerate the commit messages based on the feedback above.
Every file listed in the change summary MUST appear in exactly one commit's files array.
Use the exact file paths from the change list; never invent, abbreviate, or summarize paths.`;

  const response = await provider.generate(feedbackInput, 'commit');
  const result = provider.parseResponse(response);

  const normalized = normalizeCommits(result.commits, validFiles);

  return {
    commits: normalized.commits,
    missing: normalized.missing,
    dropped: normalized.dropped,
    duplicates: normalized.duplicates,
    raw: response.raw,
  };
}

export interface InteractiveLoopInput {
  provider: AIProvider;
  initialCommits: Commit[];
  initialResponse: string;
  validFiles: Set<string>;
  originalInput: string;
  initialCoverage: CoverageState;
  config: GencoConfig;
}

/**
 * Main interactive loop
 */
export async function runInteractiveLoop(params: InteractiveLoopInput): Promise<void> {
  const { provider, validFiles, originalInput, config } = params;
  let commits = params.initialCommits;
  let lastResponse = params.initialResponse;
  let coverage = params.initialCoverage;

  while (true) {
    displayCommits(commits);

    if (coverage.missing.length > 0) {
      logger.warning(
        `Cannot commit: ${coverage.missing.length} changed file(s) are not assigned to any commit.`
      );
    }

    console.log(
      `${chalk.yellow('[y]')} Commit all  ` +
      `${chalk.yellow('[n]')} Cancel  ` +
      `${chalk.yellow('[f]')} Feedback  ` +
      `${chalk.yellow('[t]')} Assign Jira tickets`
    );

    const action = await promptAction();

    switch (action) {
      case 'commit': {
        if (coverage.missing.length > 0) {
          logger.error(
            'Commit blocked: some changed files are uncovered. ' +
            'Use [f] Feedback to regenerate with full coverage.'
          );
          break;
        }
        const success = await executeCommits(commits);
        if (success) {
          return;
        }
        break;
      }

      case 'cancel':
        logger.warning('Cancelled');
        return;

      case 'feedback': {
        const feedback = await promptFeedback();

        if (!feedback.trim()) {
          logger.warning('Empty feedback, skipping...');
          continue;
        }

        const spinner = ora('Sending feedback to agent...').start();

        try {
          const regen = await regenerateWithFeedback(
            provider,
            originalInput,
            lastResponse,
            feedback,
            validFiles
          );
          spinner.succeed('Regenerated');
          commits = regen.commits;
          lastResponse = regen.raw;
          coverage = { missing: regen.missing };
          validateTitleLength(commits);
          reportDropped(regen.dropped);
          reportDuplicates(regen.duplicates);
          reportMissing(regen.missing);
        } catch (error) {
          spinner.fail('Failed to regenerate');
          logger.error(String(error));
        }
        break;
      }

      case 'jira':
        try {
          const processed = await processJiraTickets(commits, provider, config);
          // The merge step re-calls the AI, which may re-introduce invented
          // paths; re-normalize before the next loop iteration.
          const normalized = normalizeCommits(processed, validFiles);
          commits = normalized.commits;
          coverage = { missing: normalized.missing };
          validateTitleLength(commits);
          reportDropped(normalized.dropped);
          reportDuplicates(normalized.duplicates);
          reportMissing(normalized.missing);
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
