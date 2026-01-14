/**
 * Provider module exports and factory
 */

import { ClaudeCodeProvider } from './claude.js';
import { CursorCLIProvider } from './cursor.js';
import type { AIProvider, ProviderType, ProviderOptions } from './types.js';

export * from './types.js';
export { ClaudeCodeProvider } from './claude.js';
export { CursorCLIProvider } from './cursor.js';

/**
 * Create a provider instance by type
 */
export function createProvider(
  type: ProviderType,
  options?: ProviderOptions
): AIProvider {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeProvider(options);
    case 'cursor-cli':
      return new CursorCLIProvider(options);
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}

/**
 * Validate provider type string
 */
export function isValidProviderType(type: string): type is ProviderType {
  return type === 'claude-code' || type === 'cursor-cli';
}
