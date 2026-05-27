/**
 * Interactive UI for commit selection and actions
 */

import readline from 'node:readline';
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

interface ActionChoice {
  key: string;
  value: UserAction;
  name: string;
}

/**
 * Build the action list. The commit label is parameterized so a batched run
 * can say "Commit this batch" while a single-pass run keeps "Commit all".
 *
 * `[f] Provide feedback` is omitted when feedback is disabled (multi-chunk
 * runs) rather than shown-and-refused. An action only appears here if
 * selecting it does something — advertising a key that just prints a warning
 * is the dead-option bug this gating fixes.
 */
function buildChoices(
  commitLabel: string,
  feedbackEnabled: boolean,
  jiraEnabled: boolean,
  cancelLabel: string
): ActionChoice[] {
  const choices: ActionChoice[] = [
    { key: 'y', value: 'commit', name: commitLabel },
    { key: 'n', value: 'cancel', name: cancelLabel },
  ];
  if (feedbackEnabled) {
    choices.push({ key: 'f', value: 'feedback', name: 'Provide feedback' });
  }
  if (jiraEnabled) {
    choices.push({ key: 't', value: 'jira', name: 'Assign Jira tickets' });
  }
  return choices;
}

export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Format a single choice line. Bracketed hotkey hints are colored so the key
 * binding is visible at a glance; the focused row gets a cyan cursor and the
 * full label is recolored cyan to match inquirer's list styling.
 */
function renderChoice(choice: ActionChoice, focused: boolean): string {
  const label = `${chalk.yellow(`[${choice.key}]`)} ${choice.name}`;
  const prefix = focused ? chalk.cyan('❯ ') : '  ';
  return prefix + (focused ? chalk.cyan(label) : label);
}

/**
 * Prompt the user for the next action.
 *
 * Renders an arrow-key navigable list. The `y`/`n`/`f`/`t` hotkeys advertised
 * in the choice labels move the cursor to the corresponding row but do NOT
 * submit on their own — submission requires Enter. This preserves the "look
 * before you confirm" review step a destination-key-fires-immediately design
 * would skip. The original `inquirer` `list` prompt ignored printable keys
 * entirely, so a `y` keystroke produced no visible effect; this prompt
 * makes the hinted keys behave as documented while keeping Enter as the
 * sole trigger for the action.
 *
 * Streams are injectable so behavior tests can drive the prompt with a
 * `PassThrough` input instead of a TTY.
 */
export async function promptAction(
  streams: PromptStreams = {},
  commitLabel = 'Commit all',
  feedbackEnabled = true,
  jiraEnabled = true,
  cancelLabel = 'Cancel'
): Promise<UserAction> {
  const input = (streams.input ?? process.stdin) as NodeJS.ReadStream;
  const output = (streams.output ?? process.stdout) as NodeJS.WriteStream;
  const choices = buildChoices(commitLabel, feedbackEnabled, jiraEnabled, cancelLabel);

  return new Promise<UserAction>((resolve) => {
    let cursor = 0;
    let renderedLines = 0;
    let settled = false;

    const supportsRaw = typeof input.setRawMode === 'function';
    const previousRaw = supportsRaw ? Boolean(input.isRaw) : false;

    const setRaw = (mode: boolean): void => {
      if (supportsRaw) {
        input.setRawMode(mode);
      }
    };

    const clearRendered = (): void => {
      if (renderedLines === 0) return;
      output.write('\r');
      for (let i = 0; i < renderedLines; i++) {
        if (i > 0) output.write('\x1B[1A');
        output.write('\x1B[2K');
      }
      renderedLines = 0;
    };

    const render = (): void => {
      clearRendered();
      const lines: string[] = [];
      lines.push(`${chalk.green('?')} What would you like to do?`);
      for (let i = 0; i < choices.length; i++) {
        lines.push(renderChoice(choices[i], i === cursor));
      }
      // No trailing newline: keeps the cursor on the last rendered line so
      // `clearRendered` can walk back through every line it wrote. With a
      // trailing '\n' the cursor parks on a blank line below, the loop
      // wastes its first clear on that blank, and the question line at the
      // top is never reached — the symptom is "? What would you like to do?"
      // accumulating once per cursor move.
      output.write(lines.join('\n'));
      renderedLines = lines.length;
    };

    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      input.removeListener('keypress', onKeypress);
      setRaw(previousRaw);
      // Pair with the `input.resume()` performed at prompt start. Without
      // this, `process.stdin` stays in flowing mode, libuv keeps the I/O
      // handle refed, and the event loop never exits — the process hangs
      // after the action completes (e.g., after `executeCommits` finishes
      // a successful commit) until the user sends SIGINT.
      if (typeof input.pause === 'function') {
        input.pause();
      }
    };

    const finish = (value: UserAction): void => {
      // Move past the prompt so the next caller's output starts on a fresh
      // line. `render` intentionally omits the trailing newline (see above),
      // so we add it here.
      output.write('\n');
      cleanup();
      resolve(value);
    };

    const onKeypress = (
      str: string | undefined,
      key: { name?: string; ctrl?: boolean; sequence?: string } | undefined
    ): void => {
      if (settled) return;
      const k = key ?? {};

      if (k.ctrl && k.name === 'c') {
        cleanup();
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (k.name === 'up') {
        cursor = (cursor - 1 + choices.length) % choices.length;
        render();
        return;
      }
      if (k.name === 'down') {
        cursor = (cursor + 1) % choices.length;
        render();
        return;
      }
      if (k.name === 'return' || k.name === 'enter') {
        finish(choices[cursor].value);
        return;
      }

      const ch = (str ?? '').toLowerCase();
      const hit = choices.find((c) => c.key === ch);
      if (hit) {
        cursor = choices.indexOf(hit);
        render();
      }
    };

    readline.emitKeypressEvents(input);
    setRaw(true);
    if (typeof input.resume === 'function') {
      input.resume();
    }
    input.on('keypress', onKeypress);
    render();
  });
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
  /**
   * Whether the [f] Feedback action can be used. Disabled for multi-chunk
   * runs because the regen path replays a single original input that no
   * longer covers the whole changeset — silently regenerating only the last
   * chunk would be worse than refusing the action.
   */
  feedbackEnabled?: boolean;
  /**
   * Present when this loop is committing one batch of a multi-batch run.
   * Drives the "Batch i/N" header and relabels the commit action so the user
   * knows [y] commits only the current batch, not the whole changeset.
   */
  batchInfo?: { index: number; total: number };
  /**
   * Non-interactive mode (from `--yes`). Skips the [y]/[n]/[f]/[t] prompt and
   * commits the current proposal directly when coverage is clean. With missing
   * coverage the loop refuses the commit and returns `'cancelled'` so the
   * caller can exit non-zero — CI / hook runs treat unattended ambiguity as a
   * failure rather than silently producing an incomplete commit set. A partial
   * batch failure (hook rejection, etc.) is likewise returned as `'cancelled'`
   * with a non-zero `landedCount`; there is no operator at the keyboard to
   * choose Retry vs Stop.
   */
  autoConfirm?: boolean;
}

export interface LoopResult {
  status: 'committed' | 'cancelled';
  /** Commits in this batch that landed. `status === 'committed'` ⇒ `totalCount`. */
  landedCount: number;
  /** Total commits proposed when the loop exited. */
  totalCount: number;
}

/**
 * Main interactive loop.
 *
 * Returns `status: 'committed'` once every commit lands and
 * `status: 'cancelled'` when the user backs out. `landedCount` reports how
 * many commits in the batch actually made it into git — non-zero on a
 * `'cancelled'` result means the batch was partially committed (e.g. a
 * pre-commit hook rejected commit K after 1..K-1 already landed). The batch
 * orchestrator uses that to invalidate the frozen plan, since the remaining
 * chunks no longer match the working tree.
 *
 * Retry semantics: once any commit in this batch has landed, the loop tracks
 * the landed count and the next `[y]` only re-runs commits from the failed
 * index onward. Without this slicing, a retry would restart at commit 0,
 * which has nothing left to stage (already committed), and silently fail
 * again — the exact "shown option does nothing" failure this design avoids.
 */
export async function runInteractiveLoop(params: InteractiveLoopInput): Promise<LoopResult> {
  const { provider, validFiles, originalInput, config } = params;
  const feedbackEnabled = params.feedbackEnabled ?? true;
  const batchInfo = params.batchInfo;
  const baseCommitLabel = batchInfo
    ? `Commit this batch (${batchInfo.index}/${batchInfo.total})`
    : 'Commit all';
  let commits = params.initialCommits;
  let lastResponse = params.initialResponse;
  let coverage = params.initialCoverage;

  // --yes branch: no prompt, no retry. The interactive loop's retry semantics
  // assume an operator can choose between Retry / Stop / Feedback / Jira on
  // each iteration; an unattended run has no such operator, so a single
  // attempt is the contract. Missing coverage or partial-batch failure is
  // surfaced as `'cancelled'` for the caller to propagate via exit code.
  if (params.autoConfirm) {
    if (batchInfo) {
      console.log(
        chalk.cyan(`\n=== Batch ${batchInfo.index}/${batchInfo.total} ===`)
      );
    }
    displayCommits(commits);
    if (coverage.missing.length > 0) {
      logger.error(
        `Commit blocked (--yes): ${coverage.missing.length} changed file(s) ` +
        `are not assigned to any commit. Re-run interactively to use [f] ` +
        `Feedback, or fix the coverage gap upstream.`
      );
      return { status: 'cancelled', landedCount: 0, totalCount: commits.length };
    }
    const result = await executeCommits(commits);
    const landedCount = result.successCount;
    if (result.ok) {
      return { status: 'committed', landedCount, totalCount: commits.length };
    }
    if (result.failure) {
      const failingCommitNum = landedCount + 1;
      const totalCommits = commits.length;
      const landedSuffix =
        landedCount > 0
          ? ` Commits 1..${landedCount} in this batch already landed.`
          : '';
      switch (result.failure.kind) {
        case 'hook':
          logger.error(
            `Commit ${failingCommitNum}/${totalCommits} was rejected by a ` +
            `pre-commit hook (--yes mode: no retry).${landedSuffix}`
          );
          break;
        case 'staging':
          logger.error(
            `Commit ${failingCommitNum}/${totalCommits} has no files left ` +
            `to stage (--yes mode: no retry).${landedSuffix}`
          );
          break;
        case 'unknown':
          logger.error(
            `Commit ${failingCommitNum}/${totalCommits} failed: ` +
            `${result.failure.message} (--yes mode: no retry).${landedSuffix}`
          );
          break;
      }
    }
    return { status: 'cancelled', landedCount, totalCount: commits.length };
  }
  // Re-display only when the proposed commit set actually changes.
  // The previous unconditional re-print on every iteration buried the
  // outcome of the prior action — most importantly the
  // `Commit blocked: ...` error from a missing-coverage [y] attempt —
  // above the next prompt, making it look like Enter did nothing. Both
  // mutation paths (`feedback` regen and `jira` merge) assign a new
  // array reference, so reference equality is sufficient.
  let displayedCommits: Commit[] | null = null;
  // Commits in this batch that have already landed in git. Non-zero only
  // after a partial-batch failure; gates the menu (no feedback / no jira
  // once any commit is immutable) and slices the retry.
  let landedCount = 0;

  while (true) {
    // After a partial commit `commits` is still the same reference, so the
    // display cache would skip the redraw. Force a redraw whenever the partial
    // state is in play so the user always sees the "X of Y already landed"
    // header above the next prompt.
    if (commits !== displayedCommits || landedCount > 0) {
      if (batchInfo) {
        console.log(
          chalk.cyan(`\n=== Batch ${batchInfo.index}/${batchInfo.total} ===`)
        );
      }
      displayCommits(commits);
      displayedCommits = commits;
      if (landedCount > 0) {
        logger.info(
          `Already landed in this batch: ${landedCount}/${commits.length}. ` +
          `Remaining: commits ${landedCount + 1}..${commits.length}.`
        );
      }
    }

    if (coverage.missing.length > 0) {
      logger.warning(
        `Cannot commit: ${coverage.missing.length} changed file(s) are not assigned to any commit.`
      );
    }

    // After a partial commit, only Retry-as-is and Stop are safe: regenerating
    // messages or merging Jira keys can't touch commits that already landed
    // immutably in git, and would also re-shuffle the remaining commits in
    // ways that no longer line up with the per-batch coverage check.
    const hasPartial = landedCount > 0;
    const effectiveFeedbackEnabled = feedbackEnabled && !hasPartial;
    const effectiveJiraEnabled = !hasPartial;
    const effectiveCommitLabel = hasPartial
      ? `Retry from commit ${landedCount + 1}/${commits.length}`
      : baseCommitLabel;
    const effectiveCancelLabel = hasPartial ? 'Stop' : 'Cancel';

    // Mirror the action menu: only advertise keys that actually do something.
    const hintParts = [
      `${chalk.yellow('[y]')} ${effectiveCommitLabel}`,
      `${chalk.yellow('[n]')} ${effectiveCancelLabel}`,
    ];
    if (effectiveFeedbackEnabled) {
      hintParts.push(`${chalk.yellow('[f]')} Feedback`);
    }
    if (effectiveJiraEnabled) {
      hintParts.push(`${chalk.yellow('[t]')} Assign Jira tickets`);
    }
    console.log(hintParts.join('  '));

    const action = await promptAction(
      {},
      effectiveCommitLabel,
      effectiveFeedbackEnabled,
      effectiveJiraEnabled,
      effectiveCancelLabel
    );

    switch (action) {
      case 'commit': {
        if (coverage.missing.length > 0) {
          logger.error(
            'Commit blocked: some changed files are uncovered. ' +
            (feedbackEnabled
              ? 'Use [f] Feedback to regenerate with full coverage.'
              : 'Cancel and re-run after addressing the missing files.')
          );
          break;
        }
        const remaining = commits.slice(landedCount);
        const result = await executeCommits(remaining);
        landedCount += result.successCount;
        if (result.ok) {
          return { status: 'committed', landedCount, totalCount: commits.length };
        }
        if (result.failure) {
          const failingCommitNum = landedCount + 1; // 1-based, absolute
          const totalCommits = commits.length;
          const landedSuffix =
            landedCount > 0
              ? ` Commits 1..${landedCount} in this batch already landed.`
              : '';
          switch (result.failure.kind) {
            case 'hook':
              logger.error(
                `Commit ${failingCommitNum}/${totalCommits} was rejected by a ` +
                `pre-commit hook. Fix the issues reported above in your editor, ` +
                `then press [y] to retry from this commit.${landedSuffix}`
              );
              break;
            case 'staging':
              logger.error(
                `Commit ${failingCommitNum}/${totalCommits} has no files left ` +
                `to stage (files may have been modified or removed outside ` +
                `genai-commit). Press [n] to stop and re-run.${landedSuffix}`
              );
              break;
            case 'unknown':
              logger.error(
                `Commit ${failingCommitNum}/${totalCommits} failed: ` +
                `${result.failure.message}. Press [y] to retry or [n] to ` +
                `stop.${landedSuffix}`
              );
              break;
          }
        }
        // Force the partial-state header to print above the next prompt even
        // though the commits reference did not change.
        displayedCommits = null;
        break;
      }

      case 'cancel':
        if (landedCount > 0) {
          logger.warning(
            `Stopped after ${landedCount}/${commits.length} commits in this batch.`
          );
        } else {
          logger.warning('Cancelled');
        }
        return { status: 'cancelled', landedCount, totalCount: commits.length };

      case 'feedback': {
        // Unreachable when feedback is disabled: buildChoices omits [f] for
        // multi-chunk runs, so 'feedback' can only arrive here when enabled.
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
 * Ask how to batch a multi-chunk run, returning the chosen chunks-per-batch.
 *
 * Offered choices are derived from the chunk count: "all at once" plus a few
 * batch-count splits (3 / 5 / 10 batches) that actually divide the set, plus a
 * custom size. The split choice lives here — right after planning, when the
 * chunk count is known — rather than at the commit prompt, because the
 * timeout / token-exhaustion risk this guards against happens DURING per-chunk
 * generation, which precedes any commit confirmation.
 *
 * Caller must only invoke this for chunkCount >= 2 on an interactive TTY.
 */
export async function promptBatchCount(chunkCount: number): Promise<number> {
  const CUSTOM = -1;
  const choices: { name: string; value: number }[] = [
    { name: `All at once (1 batch, ${chunkCount} chunks)`, value: chunkCount },
  ];
  const seenSizes = new Set<number>([chunkCount]);
  for (const n of [3, 5, 10]) {
    if (n >= chunkCount) continue;
    const size = Math.ceil(chunkCount / n);
    if (seenSizes.has(size)) continue;
    seenSizes.add(size);
    const actual = Math.ceil(chunkCount / size);
    choices.push({ name: `${actual} batches (~${size} chunks each)`, value: size });
  }
  choices.push({ name: 'Custom batch size...', value: CUSTOM });

  const { size } = await inquirer.prompt<{ size: number }>([
    {
      type: 'list',
      name: 'size',
      message: `How would you like to process these ${chunkCount} chunks?`,
      choices,
    },
  ]);

  if (size !== CUSTOM) return size;

  const { custom } = await inquirer.prompt<{ custom: string }>([
    {
      type: 'input',
      name: 'custom',
      message: 'Chunks per batch:',
      default: String(Math.ceil(chunkCount / 5)),
      validate: (v: string): true | string => {
        const num = Number(v);
        return Number.isInteger(num) && num >= 1 ? true : 'Enter a positive integer';
      },
    },
  ]);
  return Math.max(1, Math.min(chunkCount, Math.floor(Number(custom))));
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
