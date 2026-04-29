/**
 * Main commit generation command.
 *
 * Orchestrates a multi-pass commit generation flow over a chunked changeset:
 *
 *   1. Stage everything and load every per-file diff in one git invocation.
 *   2. Plan deterministic chunks so each AI call fits within the input budget.
 *   3. Call the AI once per chunk with a chunk-scoped tree summary + diffs.
 *   4. Per chunk: normalize against THAT chunk's file set; on coverage gap,
 *      retry once with an explicit list, then fall back to a synthetic chore
 *      commit so the chunk's files always end up covered.
 *   5. Run a final cross-chunk normalization against the full change list.
 *
 * For changesets that fit in a single chunk (the common case), behavior is
 * effectively a single AI call — the chunk wrapper adds no overhead. For
 * larger changesets, coverage is guaranteed by construction: every file is
 * assigned to exactly one chunk, so no file can be silently dropped.
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
  getAllChangedFiles,
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
import { runInteractiveLoop } from '../ui/interactive.js';
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
 * Execute the chunked commit-generation pipeline.
 *
 * Returns the combined commit list, the final cross-chunk normalization
 * result, and metadata the interactive loop needs (notably whether feedback
 * regeneration is supported — only viable for single-chunk runs because the
 * feedback prompt re-echoes the full input).
 */
async function runChunkedGeneration(
  provider: AIProvider,
  config: GencoConfig,
  branch: string,
  changes: GitChange[],
  validFiles: Set<string>
): Promise<{
  commits: Commit[];
  missing: string[];
  lastResponse: string;
  lastInput: string;
  chunkCount: number;
}> {
  displayProgress(1, 3, 'Loading per-file diffs...');
  const diffs = await loadFileDiffs();
  console.log(`  Loaded diffs for ${diffs.size} file(s)`);

  // Cluster-aware chunking: read parseable source content, build the import
  // graph, and route planning through it. The graph is the deterministic
  // half of the design — files connected by imports stay in the same chunk
  // so the AI sees structurally cohesive groups. When no edges exist
  // (changeset is all binaries, configs, or unsupported languages), we fall
  // back to the directory-based planChunks so adjacency still proxies for
  // relatedness.
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
  const strategy = edgeCount > 0 ? 'cluster' : 'directory';
  console.log(
    `  Planned ${chunks.length} chunk(s) for ${changes.length} changed file(s) (${strategy} strategy)`
  );

  const allCommits: Commit[] = [];
  let lastResponse = '';
  let lastInput = '';

  const spinner = ora('Calling AI agent...').start();
  try {
    for (const chunk of chunks) {
      const result = await runChunkPass(
        provider,
        config,
        branch,
        chunk,
        diffs,
        chunks.length,
        spinner
      );
      allCommits.push(...result.commits);
      lastResponse = result.raw;
      lastInput = result.input;
    }
    const total = chunks.length > 1
      ? `AI responses received (${chunks.length} chunks)`
      : 'AI response received';
    spinner.succeed(total);
  } catch (error) {
    spinner.fail('Failed to generate commits');
    throw error;
  }

  // Final cross-chunk normalization. Coverage should be complete by
  // construction (per-chunk fallback commits guarantee no file is dropped),
  // but we still run normalization to catch any cross-chunk duplicate that
  // could appear if the AI somehow referenced a file from another chunk.
  const finalNormalized = normalizeCommits(allCommits, validFiles);
  reportDropped(finalNormalized.dropped);
  reportDuplicates(finalNormalized.duplicates);

  return {
    commits: finalNormalized.commits,
    missing: finalNormalized.missing,
    lastResponse,
    lastInput,
    chunkCount: chunks.length,
  };
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
  const validFiles = await getAllChangedFiles();

  displayAnalysisStart(branch, options.model);

  try {
    const result = await runChunkedGeneration(
      aiProvider,
      config,
      branch,
      changes,
      validFiles
    );

    // Cross-chunk semantic merge: when multiple chunks produced multiple
    // commits, ask the AI to coalesce ones that describe the same logical
    // change (impossible to detect deterministically). Validation rolls
    // back to per-chunk commits if the merge drops files, fabricates
    // paths, or overshoots the title cap — coverage is preserved either
    // way because the per-chunk commits already passed validation.
    let finalCommits = result.commits;
    let finalMissing = result.missing;
    if (shouldRunMerge(result.chunkCount, result.commits)) {
      const mergeSpinner = ora(
        `Merging ${result.commits.length} chunk-level commits across chunks...`
      ).start();
      try {
        const merged = await runCrossChunkMerge(
          aiProvider,
          config,
          result.commits,
          validFiles,
          mergeSpinner
        );
        if (merged) {
          finalCommits = merged.commits;
          finalMissing = [];
          mergeSpinner.succeed(
            `Merged into ${merged.commits.length} commit(s)`
          );
        } else {
          mergeSpinner.warn('Cross-chunk merge skipped; using per-chunk commits');
        }
      } catch (error) {
        mergeSpinner.fail('Cross-chunk merge errored; using per-chunk commits');
        logger.warning(String(error));
      }
    }

    validateTitleLength(finalCommits);
    reportMissing(finalMissing);

    if (finalMissing.length > 0) {
      logger.error(
        'Refusing to commit with incomplete coverage. ' +
        'Use [f] Feedback to ask the AI to include every listed file, ' +
        'or re-run with a larger --timeout and/or --model.'
      );
    }

    // Feedback regen replays the original AI input plus the previous
    // response; for multi-chunk runs there is no single "original input"
    // that covers every file, so the regen path would silently work on
    // only the last chunk. Disable it explicitly in that case rather than
    // silently producing a partial regeneration.
    const feedbackEnabled = result.chunkCount === 1;

    await runInteractiveLoop({
      provider: aiProvider,
      initialCommits: finalCommits,
      initialResponse: result.lastResponse,
      validFiles,
      originalInput: result.lastInput,
      initialCoverage: { missing: finalMissing },
      config,
      feedbackEnabled,
    });
  } catch (error) {
    logger.error(String(error));
    console.log('');
    console.log('If this issue persists, please report it at:');
    console.log('  https://github.com/Seungwoo321/genai-commit/issues');
    console.log('');
    process.exit(1);
  }
}
