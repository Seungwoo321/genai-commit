/**
 * Status command to check provider availability
 */

import chalk from 'chalk';
import type { ProviderType } from '../providers/types.js';
import { createProvider, isValidProviderType } from '../providers/index.js';
import { logger } from '../utils/logger.js';

/**
 * Status command handler
 */
export async function statusCommand(provider: string): Promise<void> {
  // Validate provider
  if (!isValidProviderType(provider)) {
    logger.error(`Unknown provider: ${provider}`);
    console.log('Available providers: claude-code, cursor-cli');
    process.exit(1);
  }

  const providerType = provider as ProviderType;
  const aiProvider = createProvider(providerType);

  try {
    const status = await aiProvider.status();

    console.log(chalk.cyan(`${providerType} status:`));

    if (status.available) {
      console.log(chalk.green('✓ Available'));
      if (status.version) {
        console.log(`  Version: ${status.version}`);
      }
    } else {
      console.log(chalk.red('✗ Not available'));
    }

    console.log(`  ${status.details}`);
  } catch (error) {
    logger.error(`Failed to check status: ${error}`);
    process.exit(1);
  }
}
