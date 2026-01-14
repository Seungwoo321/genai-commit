/**
 * Configuration type definitions
 */

import type { Language } from '../types/commit.js';

export interface GencoConfig {
  maxInputSize: number;
  maxDiffSize: number;
  timeout: number;
  treeDepth: number;
  maxRetries: number;
  titleLang: Language;
  messageLang: Language;
}

export interface ProviderOptions {
  model?: string;
  timeout?: number;
}

export type ProviderType = 'claude-code' | 'cursor-cli';
