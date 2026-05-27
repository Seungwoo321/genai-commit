/**
 * Main commit generation command.
 *
 * Orchestrates a multi-pass commit generation flow over a chunked changeset:
 *
 *   1. Stage everything and load every per-file diff in one git invocation.
 *   2. Resolve a chunk plan: reload a frozen plan when resuming, otherwise
 *      compute deterministic chunks once and freeze them to disk so the split
 *      is stable across resumes (see plan-store for why freezing is required).
 *   3. Process the plan in batches. Per batch: call the AI once per chunk with
 *      a chunk-scoped tree summary + diffs, normalize against THAT chunk's file
 *      set, retry once on a coverage gap, then fall back to a synthetic chore
 *      commit so the chunk's files always end up covered.
 *   4. Run a cross-chunk semantic merge scoped to the batch, then hand the
 *      batch to the interactive loop. A committed batch marks its chunks done
 *      and persists; a cancelled batch keeps the frozen plan for a later
 *      `--resume` (or clears it if nothing was committed yet).
 *
 * For changesets that fit in a single chunk (the common case), behavior is
 * effectively a single AI call — one chunk, one batch, no extra overhead. For
 * larger changesets, coverage is guaranteed by construction: every file is
 * assigned to exactly one chunk, so no file can be silently dropped, and the
 * frozen plan guarantees the same changeset always yields the same split even
 * when committed across several invocations.
 */

import ora, { type Ora } from 'ora';
import type { ProviderOptions, AIProvider, ProviderResponse } from '../providers/types.js';
import { PROVIDER_CHOICES } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import type { Language, Commit } from '../types/commit.js';
import type { GitChange } from '../types/git.js';
import { createProvider, normalizeProviderType } from '../providers/index.js';
import {
  isGitRepository,
  getCurrentBranch,
  getGitStatus,
  hasChanges,
  getRemoteStatus,
  stageAllChanges,
} from '../git/status.js';
import { generateFullTreeSummary } from '../git/tree.js';
import { loadFileDiffs, getDiffContentForFiles } from '../git/diff.js';
import { planChunks, chunkFiles, type Chunk } from '../git/chunk.js';
import { buildImportGraph } from '../git/imports.js';
import { loadSourceContents } from '../git/source.js';
import { planClusteredChunks } from '../git/cluster.js';
import { runInteractiveLoop, promptBatchCount } from '../ui/interactive.js';
import {
  freezePlan,
  savePlan,
  loadPlan,
  clearPlan,
  isPlanFresh,
  pendingChunks,
  doneCount,
  markChunksDone,
  groupIntoBatches,
  toChunk,
  type PersistedPlan,
  type PersistedChunk,
  type ChunkStrategy,
} from '../git/plan-store.js';
import { runCrossChunkMerge, shouldRunMerge } from './merge.js';
import {
  displayAnalysisStart,
  displayProgress,
  reportDropped,
  reportDuplicates,
  reportMissing,
} from '../ui/display.js';
import { normalizeCommits, validateTitleLength } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

export interface GenerateOptions {
  lang?: Language;
  titleLang?: Language;
  messageLang?: Language;
  model?: string;
  timeout?: string | number;
  /** Split a multi-chunk plan into this many batches (overrides the prompt). */
  batches?: string | number;
  /** Reload a frozen plan and continue from the next pending batch. */
  resume?: boolean;
  /** Discard any frozen plan and re-plan from the current changeset. */
  fresh?: boolean;
  /**
   * Non-interactive auto-confirm. Skips the [y]/[n]/[f]/[t] prompt entirely
   * and commits the proposed set as-is. Aborts with non-zero exit if coverage
   * is incomplete (no `[f] Feedback` retry available in this mode).
   * Designed for CI runs and hook-driven workflows (e.g., airpilot-lite).
   */
  yes?: boolean;
}

/**
 * Build the AI input for one chunk. The chunk note only appears when the
 * changeset was split — single-chunk runs get the same input shape as the
 * legacy single-pass flow, so the AI behaves identically for the common case.
 */
function buildChunkInput(
  config: GencoConfig,
  branch: string,
  chunk: Chunk,
  diffs: Map<string, string>,
  totalChunks: number
): string {
  const treeBudget = Math.max(2000, config.maxInputSize - config.maxDiffSize - 500);
  const treeSummary = generateFullTreeSummary(branch, chunk.changes, {
    maxTreeSize: treeBudget,
  });
  const filesInChunk = chunkFiles(chunk);
  const diffContent = getDiffContentForFiles(treeSummary, filesInChunk, diffs, {
    maxInputSize: config.maxInputSize,
    maxDiffSize: config.maxDiffSize,
  });

  const header = `TITLE_LANG: ${config.titleLang}\nMESSAGE_LANG: ${config.messageLang}`;

  if (totalChunks <= 1) {
    return `${header}\n\n${treeSummary}${diffContent}`;
  }

  // The note tells the AI not to reference files outside the chunk. Without
  // it, the AI sometimes invents paths it remembers from training data when
  // the listed file set looks "incomplete" for a logical change.
  const note =
    `[CHUNK ${chunk.index + 1}/${totalChunks}] This input contains a SUBSET ` +
    `of the full changeset (${chunk.changes.length} of many files). Group ` +
    `ONLY the files listed below; do not reference any file not present in ` +
    `the FILE LIST.`;

  return `${header}\n\n${note}\n\n${treeSummary}${diffContent}`;
}

/**
 * Build a synthetic fallback commit covering files the AI failed to assign.
 *
 * Used as the last-resort recovery when a chunk's AI response (and its
 * single retry) leave files uncovered. Without this fallback the final
 * coverage check would fail and the commit flow would block again — the
 * exact failure mode this redesign exists to eliminate.
 */
function buildFallbackCommit(missing: string[]): Commit {
  return {
    files: [...missing],
    title: `chore: include ${missing.length} unassigned file(s)`,
    message:
      'These files were not assigned to any commit by the AI; bundled ' +
      'here so coverage of the changeset is preserved.',
  };
}

/**
 * Run one AI pass for a chunk and return the chunk's commits along with the
 * raw AI response (kept so feedback regeneration in single-chunk runs can
 * echo it back).
 *
 * On chunk-internal coverage gap, performs a single targeted retry. If still
 * incomplete, appends a synthetic chore commit so coverage is preserved.
 */
async function runChunkPass(
  provider: AIProvider,
  config: GencoConfig,
  branch: string,
  chunk: Chunk,
  diffs: Map<string, string>,
  totalChunks: number,
  spinner: Ora
): Promise<{ commits: Commit[]; raw: string; input: string }> {
  const input = buildChunkInput(config, branch, chunk, diffs, totalChunks);
  const chunkValidFiles = new Set(chunkFiles(chunk));

  const label = totalChunks > 1 ? ` (chunk ${chunk.index + 1}/${totalChunks})` : '';
  spinner.text = `Calling AI agent${label} (${chunk.changes.length} files)...`;

  let response: ProviderResponse = await provider.generate(input, 'commit');
  let parsed = provider.parseResponse(response);
  let normalized = normalizeCommits(parsed.commits, chunkValidFiles);

  if (normalized.missing.length > 0) {
    // Targeted retry: re-issue the same prompt with the explicit list of
    // files the AI dropped. One retry is enough in practice — if the AI
    // omits files a second time the synthetic fallback handles it.
    spinner.text = `Retrying chunk ${chunk.index + 1}/${totalChunks} for coverage...`;
    const retryInput =
      `${input}\n\n[COVERAGE RETRY] The previous response omitted the ` +
      `following files. Every file below MUST appear in exactly one ` +
      `commit's files array, copied VERBATIM:\n` +
      normalized.missing.map((f) => `- ${f}`).join('\n');
    response = await provider.generate(retryInput, 'commit');
    parsed = provider.parseResponse(response);
    normalized = normalizeCommits(parsed.commits, chunkValidFiles);
  }

  reportDropped(normalized.dropped);
  reportDuplicates(normalized.duplicates);

  const commits = [...normalized.commits];
  if (normalized.missing.length > 0) {
    logger.warning(
      `Chunk ${chunk.index + 1}/${totalChunks}: ${normalized.missing.length} ` +
      `file(s) still uncovered after retry; adding synthetic fallback commit.`
    );
    commits.push(buildFallbackCommit(normalized.missing));
  }

  return { commits, raw: response.raw, input };
}

/**
 * Compute the deterministic chunk plan for a fresh changeset.
 *
 * Cluster-aware chunking: read parseable source content, build the import
 * graph, and route planning through it. The graph is the deterministic half
 * of the design — files connected by imports stay in the same chunk so the AI
 * sees structurally cohesive groups. When no edges exist (changeset is all
 * binaries, configs, or unsupported languages), fall back to the
 * directory-based planChunks so adjacency still proxies for relatedness.
 *
 * Only invoked when freezing a new plan; resumes reload the frozen chunks and
 * never re-run this (re-running First-Fit Decreasing on a shrunken set would
 * repack the remainder differently — the exact instability the freeze guards).
 */
async function planForChangeset(
  config: GencoConfig,
  changes: GitChange[],
  diffs: Map<string, string>
): Promise<{ chunks: Chunk[]; strategy: ChunkStrategy }> {
  displayProgress(2, 3, 'Building import graph...');
  const fileContents = await loadSourceContents(changes);
  const graph = buildImportGraph(fileContents);
  let edgeCount = 0;
  for (const outs of graph.values()) edgeCount += outs.size;
  console.log(
    `  Parsed ${fileContents.size} source file(s); found ${edgeCount} import edge(s)`
  );

  displayProgress(3, 3, 'Planning chunks...');
  const treeBudget = Math.max(2000, config.maxInputSize - config.maxDiffSize - 500);
  const budget = {
    maxDiffSize: config.maxDiffSize,
    treeBudget,
  };
  const chunks = edgeCount > 0
    ? planClusteredChunks(changes, diffs, graph, budget)
    : planChunks(changes, diffs, budget);
  const strategy: ChunkStrategy = edgeCount > 0 ? 'cluster' : 'directory';
  console.log(
    `  Planned ${chunks.length} chunk(s) for ${changes.length} changed file(s) (${strategy} strategy)`
  );
  return { chunks, strategy };
}

/**
 * Run every chunk in one batch and normalize the union against the batch's
 * own file set. Coverage is complete by construction (per-chunk fallback
 * commits guarantee no file is dropped); the batch-level normalize still runs
 * to catch a cross-chunk duplicate the AI could produce by referencing a file
 * from a sibling chunk within the batch.
 *
 * `overallChunkCount` is the frozen plan's total chunk count — passed through
 * to runChunkPass so the "[CHUNK i/N]" note and spinner label keep the
 * absolute numbering the user saw at planning time, not a per-batch reset.
 */
async function generateBatch(
  provider: AIProvider,
  config: GencoConfig,
  branch: string,
  batchChunks: Chunk[],
  diffs: Map<string, string>,
  overallChunkCount: number,
  batchValidFiles: Set<string>
): Promise<{
  commits: Commit[];
  missing: string[];
  lastResponse: string;
  lastInput: string;
}> {
  const allCommits: Commit[] = [];
  let lastResponse = '';
  let lastInput = '';

  const spinner = ora('Calling AI agent...').start();
  try {
    for (const chunk of batchChunks) {
      const result = await runChunkPass(
        provider,
        config,
        branch,
        chunk,
        diffs,
        overallChunkCount,
        spinner
      );
      allCommits.push(...result.commits);
      lastResponse = result.raw;
      lastInput = result.input;
    }
    const total = batchChunks.length > 1
      ? `AI responses received (${batchChunks.length} chunks)`
      : 'AI response received';
    spinner.succeed(total);
  } catch (error) {
    spinner.fail('Failed to generate commits');
    throw error;
  }

  const normalized = normalizeCommits(allCommits, batchValidFiles);
  reportDropped(normalized.dropped);
  reportDuplicates(normalized.duplicates);

  return {
    commits: normalized.commits,
    missing: normalized.missing,
    lastResponse,
    lastInput,
  };
}

/**
 * Cross-chunk semantic merge scoped to a batch's commits. When a batch
 * produced multiple chunk-level commits, ask the AI to coalesce ones that
 * describe the same logical change. Validation inside runCrossChunkMerge
 * rolls back to the per-chunk commits if the merge drops files, fabricates
 * paths, or overshoots the title cap — coverage is preserved either way.
 *
 * Returns the per-chunk commits unchanged when the merge is a no-op, is
 * skipped, or errors.
 */
async function mergeCommits(
  provider: AIProvider,
  config: GencoConfig,
  commits: Commit[],
  chunkCount: number,
  validFiles: Set<string>
): Promise<Commit[]> {
  if (!shouldRunMerge(chunkCount, commits)) return commits;

  const spinner = ora(
    `Merging ${commits.length} chunk-level commits across chunks...`
  ).start();
  try {
    const merged = await runCrossChunkMerge(
      provider,
      config,
      commits,
      validFiles,
      spinner
    );
    if (merged) {
      spinner.succeed(`Merged into ${merged.commits.length} commit(s)`);
      return merged.commits;
    }
    spinner.warn('Cross-chunk merge skipped; using per-chunk commits');
    return commits;
  } catch (error) {
    spinner.fail('Cross-chunk merge errored; using per-chunk commits');
    logger.warning(String(error));
    return commits;
  }
}

/**
 * Collect every file path (including the `from` side of a rename) covered by
 * a batch's chunks. Scoping coverage checks to the batch keeps a partial run
 * from flagging other batches' still-uncommitted files as "missing".
 */
function collectBatchValidFiles(chunks: PersistedChunk[]): Set<string> {
  const files = new Set<string>();
  for (const chunk of chunks) {
    for (const c of chunk.changes) {
      files.add(c.file);
      if (c.from) files.add(c.from);
    }
  }
  return files;
}

/**
 * Translate the batch request into chunks-per-batch.
 *
 *  - chunkCount <= 1: nothing to split; one batch holds everything.
 *  - --batches <n>: split into n batches (capped at chunkCount).
 *  - interactive TTY: ask via promptBatchCount.
 *  - otherwise (piped / CI): all chunks in a single batch.
 */
async function resolveBatchSize(
  options: GenerateOptions,
  chunkCount: number
): Promise<number> {
  if (chunkCount <= 1) return Math.max(1, chunkCount);

  if (options.batches !== undefined) {
    const n = typeof options.batches === 'number'
      ? options.batches
      : Number(options.batches);
    if (!Number.isInteger(n) || n < 1) {
      logger.error(`Invalid --batches value: ${options.batches}`);
      process.exit(1);
    }
    return Math.ceil(chunkCount / Math.min(n, chunkCount));
  }

  // --yes is non-interactive by contract: never call promptBatchCount even on
  // a TTY, because the prompt would hang a CI/hook run. Falls back to the same
  // "all chunks in a single batch" default as a piped invocation.
  if (!options.yes && process.stdout.isTTY && process.stdin.isTTY) {
    return promptBatchCount(chunkCount);
  }

  return chunkCount;
}

/**
 * Resolve the chunk plan for this invocation.
 *
 * Resume path: a saved plan that still matches the working tree is reloaded
 * verbatim so the frozen boundaries (and batch size) survive across runs.
 * Fresh path: plan the changeset, ask how to batch it, freeze, and persist.
 *
 * --fresh always discards any saved plan first. --resume requires a saved,
 * still-fresh plan and errors otherwise (rather than silently re-planning),
 * because the user explicitly asked to continue an existing run.
 */
async function resolvePlan(
  options: GenerateOptions,
  config: GencoConfig,
  changes: GitChange[],
  diffs: Map<string, string>
): Promise<PersistedPlan> {
  if (options.fresh) {
    await clearPlan();
  } else {
    const existing = await loadPlan();
    if (existing) {
      if (isPlanFresh(existing, changes, diffs)) {
        const done = doneCount(existing);
        if (done > 0) {
          logger.info(
            `Resuming saved plan: ${done}/${existing.chunks.length} chunk(s) already committed.`
          );
        } else {
          logger.info(
            `Reusing saved plan (${existing.chunks.length} chunk(s), ${existing.strategy} strategy).`
          );
        }
        return existing;
      }
      if (options.resume) {
        logger.error(
          'Saved plan no longer matches the working tree (files changed or added).'
        );
        logger.error('Re-run with --fresh to discard it and re-plan.');
        process.exit(1);
      }
      logger.warning(
        'Saved plan is stale (changeset changed); discarding and re-planning.'
      );
      await clearPlan();
    } else if (options.resume) {
      logger.error('No saved plan to resume. Run without --resume to create one.');
      process.exit(1);
    }
  }

  const { chunks, strategy } = await planForChangeset(config, changes, diffs);
  const batchSize = await resolveBatchSize(options, chunks.length);
  const plan = freezePlan(chunks, strategy, batchSize, diffs);
  await savePlan(plan);
  return plan;
}

/**
 * Main generate command handler
 */
export async function generateCommand(
  provider: string,
  options: GenerateOptions
): Promise<void> {
  // Validate and normalize provider (accepts short aliases)
  const providerType = normalizeProviderType(provider);
  if (!providerType) {
    logger.error(`Unknown provider: ${provider}`);
    console.log(`Available providers: ${PROVIDER_CHOICES}`);
    process.exit(1);
  }

  // Check if in git repository
  if (!(await isGitRepository())) {
    logger.error('Error: Not a git repository');
    process.exit(1);
  }

  // Check for changes
  if (!(await hasChanges())) {
    logger.warning('No changes to commit');
    process.exit(0);
  }

  // Check remote status and abort if behind
  const remoteStatus = await getRemoteStatus();
  if (remoteStatus.hasRemote) {
    if (remoteStatus.diverged) {
      logger.error(`Branch has diverged from remote (${remoteStatus.ahead} ahead, ${remoteStatus.behind} behind)`);
      logger.error('Run: git pull --rebase');
      process.exit(1);
    } else if (remoteStatus.needsPull) {
      logger.error(`Branch is ${remoteStatus.behind} commit(s) behind remote`);
      logger.error('Run: git pull');
      process.exit(1);
    }
  }

  // Stage all changes for consistent diff analysis
  await stageAllChanges();

  // Resolve timeout override (--timeout is in seconds; internal unit is ms)
  let timeoutMs = DEFAULT_CONFIG.timeout;
  if (options.timeout !== undefined) {
    const raw = typeof options.timeout === 'number'
      ? options.timeout
      : Number(options.timeout);
    if (!Number.isFinite(raw) || raw <= 0) {
      logger.error(`Invalid --timeout value: ${options.timeout}`);
      process.exit(1);
    }
    timeoutMs = Math.round(raw * 1000);
  }

  // Build config
  const config: GencoConfig = {
    ...DEFAULT_CONFIG,
    timeout: timeoutMs,
    titleLang: options.lang ?? options.titleLang ?? DEFAULT_CONFIG.titleLang,
    messageLang: options.lang ?? options.messageLang ?? DEFAULT_CONFIG.messageLang,
  };

  // Provider options
  const providerOptions: ProviderOptions = {
    model: options.model,
    timeout: config.timeout,
  };

  // Create provider
  const aiProvider = createProvider(providerType, providerOptions);

  // Get branch and changes
  const branch = await getCurrentBranch();
  const { changes } = await getGitStatus();

  displayAnalysisStart(branch, options.model);

  try {
    displayProgress(1, 3, 'Loading per-file diffs...');
    const diffs = await loadFileDiffs();
    console.log(`  Loaded diffs for ${diffs.size} file(s)`);

    const plan = await resolvePlan(options, config, changes, diffs);

    const overallChunkCount = plan.chunks.length;
    const batchSize = plan.batchSize;
    const totalBatches = Math.ceil(overallChunkCount / batchSize);

    // batchOrdinal is the absolute (1-based) batch number so the "Batch i/N"
    // header stays consistent across resumes. Done chunks are always a
    // batch-aligned prefix (commits are batch-atomic and processed in order),
    // so the count of completed batches is ceil(doneCount / batchSize).
    let batchOrdinal = Math.ceil(doneCount(plan) / batchSize);

    const batches = groupIntoBatches(pendingChunks(plan), batchSize);

    for (const batchChunks of batches) {
      batchOrdinal++;
      const batchInfo = totalBatches > 1
        ? { index: batchOrdinal, total: totalBatches }
        : undefined;
      const batchValidFiles = collectBatchValidFiles(batchChunks);
      const execChunks = batchChunks.map(toChunk);

      const gen = await generateBatch(
        aiProvider,
        config,
        branch,
        execChunks,
        diffs,
        overallChunkCount,
        batchValidFiles
      );

      const finalCommits = await mergeCommits(
        aiProvider,
        config,
        gen.commits,
        execChunks.length,
        batchValidFiles
      );
      const finalMissing = gen.missing;

      validateTitleLength(finalCommits);
      reportMissing(finalMissing);
      if (finalMissing.length > 0) {
        logger.error(
          'Refusing to commit with incomplete coverage. ' +
          'Use [f] Feedback to ask the AI to include every listed file, ' +
          'or re-run with a larger --timeout and/or --model.'
        );
      }

      // Feedback regen replays a single chunk's original input; it is only
      // sound when the batch is exactly one chunk, because then that input
      // covers all of batchValidFiles. A multi-chunk batch would regenerate
      // against only the last chunk's input, so disable it there.
      const feedbackEnabled = execChunks.length === 1;

      const loopResult = await runInteractiveLoop({
        provider: aiProvider,
        initialCommits: finalCommits,
        initialResponse: gen.lastResponse,
        validFiles: batchValidFiles,
        originalInput: gen.lastInput,
        initialCoverage: { missing: finalMissing },
        config,
        feedbackEnabled,
        batchInfo,
        autoConfirm: options.yes,
      });

      if (loopResult.status === 'committed') {
        markChunksDone(plan, batchChunks.map((c) => c.index));
        await savePlan(plan);
      } else {
        // Cancelled.
        // Three sub-cases:
        //  1. Partial commit in this batch (some commits landed before the
        //     user stopped) — the frozen plan's chunk boundaries no longer
        //     line up with what's left in the working tree, and
        //     `isPlanFresh` would reject a `--resume`. Clear the plan so the
        //     next run re-plans cleanly from the current changeset.
        //  2. Nothing landed in this batch but prior batches did — keep the
        //     plan so `--resume` can finish the rest.
        //  3. Nothing landed anywhere — drop the plan to avoid a stale resume.
        if (loopResult.landedCount > 0) {
          logger.warning(
            `Batch was partially committed ` +
            `(${loopResult.landedCount}/${loopResult.totalCount}). ` +
            'Discarding the saved plan since the remaining work no longer ' +
            'matches it. Re-run genai-commit to plan from the current ' +
            'changeset.'
          );
          await clearPlan();
        } else if (doneCount(plan) > 0) {
          logger.info('Stopped. Re-run with --resume to continue from the next batch.');
        } else {
          await clearPlan();
        }
        // Unattended runs must propagate "did not commit cleanly" to the caller
        // so CI / hooks / shell scripts can branch on it. Interactive cancel
        // (without --yes) is a user choice, not a failure — keep its exit 0.
        if (options.yes) {
          process.exitCode = 1;
        }
        return;
      }
    }

    await clearPlan();
    if (totalBatches > 1) {
      logger.success(`All ${totalBatches} batches committed.`);
    }
  } catch (error) {
    logger.error(String(error));
    console.log('');
    console.log('If this issue persists, please report it at:');
    console.log('  https://github.com/Seungwoo321/genai-commit/issues');
    console.log('');
    process.exit(1);
  }
}
