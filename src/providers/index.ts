/**
 * Provider module exports and factory
 */

import { ClaudeCodeProvider } from './claude.js';
import { CursorCLIProvider } from './cursor.js';
import { CodexCLIProvider } from './codex.js';
import { PROVIDER_ALIASES } from './types.js';
import type { AIProvider, ProviderType, ProviderOptions } from './types.js';

export * from './types.js';
export { ClaudeCodeProvider } from './claude.js';
export { CursorCLIProvider } from './cursor.js';
export { CodexCLIProvider } from './codex.js';

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
    case 'codex-cli':
      return new CodexCLIProvider(options);
    default:
      throw new Error(`Unknown provider: ${type as string}`);
  }
}

/**
 * Type guard for canonical provider types.
 * Short aliases (e.g. 'claude') return false — use normalizeProviderType first.
 */
export function isValidProviderType(type: string): type is ProviderType {
  return type === 'claude-code' || type === 'cursor-cli' || type === 'codex-cli';
}

/**
 * Resolve a user-supplied provider string (canonical or alias) to the canonical ProviderType.
 * Returns null if the input is not recognized.
 */
export function normalizeProviderType(input: string): ProviderType | null {
  return PROVIDER_ALIASES[input] ?? null;
}
