/**
 * Main commit generation command
 */

import ora from 'ora';
import type { ProviderOptions } from '../providers/types.js';
import { PROVIDER_CHOICES } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import type { Language } from '../types/commit.js';
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
import { getDiffContent } from '../git/diff.js';
import { runInteractiveLoop } from '../ui/interactive.js';
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

  // Tree summary is capped relative to the input budget so a custom
  // `maxInputSize` shrinks the tree cap accordingly. Reserve headroom for
  // the header and at least a minimal diff; if the resulting cap is
  // non-positive the tree will still emit the CHANGE SUMMARY header.
  const treeBudget = Math.max(2000, config.maxInputSize - config.maxDiffSize - 500);

  // Generate tree summary
  displayProgress(1, 2, 'Generating file tree summary...');
  const treeSummary = generateFullTreeSummary(branch, changes, { maxTreeSize: treeBudget });
  const treeSize = treeSummary.length;
  console.log(`  Tree summary: ${treeSize} bytes`);

  // Get diff content
  displayProgress(2, 2, 'Extracting modified file diffs...');
  const diffContent = await getDiffContent(treeSummary, {
    maxInputSize: config.maxInputSize,
    maxDiffSize: config.maxDiffSize,
  });
  const diffSize = diffContent.length;

  if (diffSize > 0) {
    console.log(`  Diff content: ${diffSize} bytes`);
  } else if (treeSize > config.maxInputSize - 1500) {
    console.log(`  Diff content: skipped (tree consumed input budget)`);
  } else {
    console.log(`  Diff content: none (no tracked file diffs)`);
  }

  // Build input
  const input = `TITLE_LANG: ${config.titleLang}
MESSAGE_LANG: ${config.messageLang}

${treeSummary}${diffContent}`;

  const inputSize = input.length;
  logger.success(`Total input size: ${inputSize} bytes`);

  // Call AI provider
  const spinner = ora('Calling AI agent...').start();

  try {
    const response = await aiProvider.generate(input, 'commit');
    spinner.succeed('AI response received');

    // Parse response
    const result = aiProvider.parseResponse(response);

    // Normalize against the real change list: resolve directory-level entries
    // to actual files, drop anything that does not match a changed file, dedup
    // cross-commit duplicates, and compute coverage gaps. Without this,
    // synthetic paths reach `git add` and duplicated files hit an empty index
    // on their second commit.
    const { commits: normalizedCommits, dropped, duplicates, missing } = normalizeCommits(
      result.commits,
      validFiles
    );

    validateTitleLength(normalizedCommits);

    reportDropped(dropped);
    reportDuplicates(duplicates);
    reportMissing(missing);
    if (missing.length > 0) {
      logger.error(
        'Refusing to commit with incomplete coverage. ' +
        'Use [f] Feedback to ask the AI to include every listed file, ' +
        'or re-run with a larger --timeout and/or --model.'
      );
    }

    // Run interactive loop
    await runInteractiveLoop({
      provider: aiProvider,
      initialCommits: normalizedCommits,
      initialResponse: response.raw,
      validFiles,
      originalInput: input,
      initialCoverage: { missing },
      config,
    });
  } catch (error) {
    spinner.fail('Failed to generate commits');
    logger.error(String(error));
    console.log('');
    console.log('If this issue persists, please report it at:');
    console.log('  https://github.com/Seungwoo321/genai-commit/issues');
    console.log('');
    process.exit(1);
  }
}
