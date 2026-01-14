/**
 * Provider type definitions
 */

import type { CommitResult } from '../types/commit.js';

export type ProviderType = 'claude-code' | 'cursor-cli';
export type PromptType = 'commit' | 'regroup';

export interface ProviderResponse {
  raw: string;
  sessionId?: string;
}

export interface ProviderStatus {
  available: boolean;
  version?: string;
  details: string;
}

export interface ProviderOptions {
  model?: string;
  timeout?: number;
}

/**
 * AI Provider interface - implemented by claude and cursor providers
 */
export interface AIProvider {
  readonly name: ProviderType;

  /**
   * Generate commit messages from input
   */
  generate(input: string, promptType: PromptType): Promise<ProviderResponse>;

  /**
   * Parse raw response into structured commits
   */
  parseResponse(response: ProviderResponse): CommitResult;

  /**
   * Authenticate with the provider
   */
  login(): Promise<void>;

  /**
   * Check provider status and authentication
   */
  status(): Promise<ProviderStatus>;

  /**
   * Get current session ID (for resume capability)
   */
  getSessionId(): string | undefined;

  /**
   * Clear session state
   */
  clearSession(): void;
}
