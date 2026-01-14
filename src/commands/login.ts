/**
 * Login command for provider authentication
 */

import type { ProviderType } from '../providers/types.js';
import { createProvider, isValidProviderType } from '../providers/index.js';
import { logger } from '../utils/logger.js';

/**
 * Login command handler
 */
export async function loginCommand(provider: string): Promise<void> {
  // Validate provider
  if (!isValidProviderType(provider)) {
    logger.error(`Unknown provider: ${provider}`);
    console.log('Available providers: claude-code, cursor-cli');
    process.exit(1);
  }

  const providerType = provider as ProviderType;
  const aiProvider = createProvider(providerType);

  try {
    await aiProvider.login();
    logger.success('Login completed successfully');
  } catch (error) {
    logger.error(`Login failed: ${error}`);
    process.exit(1);
  }
}
