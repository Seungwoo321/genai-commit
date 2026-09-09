/**
 * Models command - list the models the provider actually offers right now
 */

import { PROVIDER_CHOICES } from '../providers/types.js';
import { normalizeProviderType } from '../providers/index.js';
import { discoverModels } from '../providers/discovery.js';
import { logger } from '../utils/logger.js';

/**
 * Models command handler.
 *
 * The list is read from the provider, so it stays correct across provider
 * releases without this package being updated. When discovery fails the command
 * says so instead of printing a built-in list — a stale list that looks
 * authoritative is what made `--model` fail in the first place.
 */
export async function modelsCommand(provider: string): Promise<void> {
  const providerType = normalizeProviderType(provider);
  if (!providerType) {
    logger.error(`Unknown provider: ${provider}`);
    console.log(`Available providers: ${PROVIDER_CHOICES}`);
    process.exit(1);
  }

  const discovery = await discoverModels(providerType);

  if (discovery.error) {
    logger.error(`\nCould not discover models for ${providerType}: ${discovery.error}`);
    console.log(`Source attempted: ${discovery.source}`);
    console.log(`\nPass --model <name> explicitly if you already know one.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nAvailable models for ${providerType}:\n`);
  for (const m of discovery.models) {
    const window = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k ctx` : '';
    const label = m.description ?? m.displayName ?? '';
    console.log(`  ${m.slug.padEnd(24)} ${window.padEnd(9)} ${label}`);
  }

  console.log(`\nSource: ${discovery.source}`);
  console.log(
    `\nWithout --model, the smallest model the input fits into is selected automatically`
  );
  console.log(
    `(where the provider publishes no context window, the cheapest tier is tried first);`
  );
  console.log(`if the provider rejects it, the next candidate is tried.`);
  console.log(`\nUsage: genai-commit ${providerType} --model <model-name>\n`);
}
