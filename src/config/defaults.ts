/**
 * Default configuration values
 */

import type { GencoConfig } from './types.js';

export const DEFAULT_CONFIG: GencoConfig = {
  maxInputSize: 30000,
  maxDiffSize: 15000,
  timeout: 120000, // 120 seconds
  maxRetries: 2,
  titleLang: 'en',
  messageLang: 'ko',
};

/**
 * No model names live here.
 *
 * Model slugs are provider-owned and change on the provider's release cadence,
 * not this package's. Every slug this file used to declare had already been
 * retired upstream, which turned the "default" into a guaranteed failure. The
 * catalog is now discovered at run time — see `src/providers/discovery.ts`.
 */
