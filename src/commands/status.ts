/**
 * Status command to check provider availability
 */

import chalk from 'chalk';
import { PROVIDER_CHOICES } from '../providers/types.js';
import { createProvider, normalizeProviderType } from '../providers/index.js';
import { logger } from '../utils/logger.js';

/**
 * Status command handler
 */
export async function statusCommand(provider: string): Promise<void> {
  const providerType = normalizeProviderType(provider);
  if (!providerType) {
    logger.error(`Unknown provider: ${provider}`);
    console.log(`Available providers: ${PROVIDER_CHOICES}`);
    process.exit(1);
  }

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
