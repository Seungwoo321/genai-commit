/**
 * Default configuration values
 */

import type { GencoConfig } from './types.js';

export const DEFAULT_CONFIG: GencoConfig = {
  maxInputSize: 30000,
  maxDiffSize: 15000,
  timeout: 120000, // 120 seconds
  treeDepth: 3,
  maxRetries: 2,
  titleLang: 'en',
  messageLang: 'ko',
};

export const CURSOR_DEFAULT_MODEL = 'gemini-3-flash';
export const CLAUDE_DEFAULT_MODEL = 'haiku';
