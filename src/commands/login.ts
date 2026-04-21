/**
 * Login command for provider authentication
 */

import { PROVIDER_CHOICES } from '../providers/types.js';
import { createProvider, normalizeProviderType } from '../providers/index.js';
import { logger } from '../utils/logger.js';

/**
 * Login command handler
 */
export async function loginCommand(provider: string): Promise<void> {
  const providerType = normalizeProviderType(provider);
  if (!providerType) {
    logger.error(`Unknown provider: ${provider}`);
    console.log(`Available providers: ${PROVIDER_CHOICES}`);
    process.exit(1);
  }

  const aiProvider = createProvider(providerType);

  try {
    await aiProvider.login();
    logger.success('Login completed successfully');
  } catch (error) {
    logger.error(`Login failed: ${error}`);
    process.exit(1);
  }
}
