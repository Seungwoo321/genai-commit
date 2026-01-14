/**
 * Main commit generation command
 */

import ora from 'ora';
import type { ProviderType, ProviderOptions } from '../providers/types.js';
import type { GencoConfig } from '../config/types.js';
import type { Language } from '../types/commit.js';
import { createProvider, isValidProviderType } from '../providers/index.js';
import {
  isGitRepository,
  getCurrentBranch,
  getGitStatus,
  getAllChangedFiles,
  hasChanges,
} from '../git/status.js';
import { generateFullTreeSummary } from '../git/tree.js';
import { getDiffContent } from '../git/diff.js';
import { runInteractiveLoop } from '../ui/interactive.js';
import { displayAnalysisStart, displayProgress, displayInputSize } from '../ui/display.js';
import { validateFilesExist, validateTitleLength } from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

export interface GenerateOptions {
  lang?: Language;
  titleLang?: Language;
  messageLang?: Language;
  model?: string;
}

/**
 * Main generate command handler
 */
export async function generateCommand(
  provider: string,
  options: GenerateOptions
): Promise<void> {
  // Validate provider
  if (!isValidProviderType(provider)) {
    logger.error(`Unknown provider: ${provider}`);
    console.log('Available providers: claude-code, cursor-cli');
    process.exit(1);
  }

  const providerType = provider as ProviderType;

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

  // Build config
  const config: GencoConfig = {
    ...DEFAULT_CONFIG,
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
  const { changes, stats } = await getGitStatus();
  const validFiles = await getAllChangedFiles();

  displayAnalysisStart(branch, options.model);

  // Generate tree summary
  displayProgress(1, 2, 'Generating file tree summary...');
  const treeSummary = generateFullTreeSummary(branch, changes, {
    treeDepth: config.treeDepth,
  });
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
  } else {
    console.log(`  Diff content: skipped (tree too large)`);
  }

  // Build input
  let input = `TITLE_LANG: ${config.titleLang}
MESSAGE_LANG: ${config.messageLang}

${treeSummary}`;

  if (diffContent) {
    input += diffContent;
  }

  const inputSize = input.length;
  logger.success(`Total input size: ${inputSize} bytes`);

  // Truncate if needed
  if (inputSize > config.maxInputSize) {
    logger.warning('Warning: Input size exceeds limit. Truncating...');
    input = input.substring(0, config.maxInputSize) +
      `\n\n[INPUT TRUNCATED - Original size: ${inputSize} bytes]`;
  }

  // Call AI provider
  const spinner = ora('Calling AI agent...').start();

  try {
    const response = await aiProvider.generate(input, 'commit');
    spinner.succeed('AI response received');

    // Parse response
    const result = aiProvider.parseResponse(response);

    // Validate
    validateFilesExist(result.commits, validFiles);
    validateTitleLength(result.commits);

    // Run interactive loop
    await runInteractiveLoop(
      aiProvider,
      result.commits,
      response.raw,
      {
        branch,
        changes,
        stats,
        treeSummary,
        diffContent,
        validFiles,
      },
      config
    );
  } catch (error) {
    spinner.fail('Failed to generate commits');
    logger.error(String(error));
    process.exit(1);
  }
}
