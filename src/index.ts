/**
 * genai-commit - AI-powered commit message generator
 *
 * Public API exports for programmatic usage
 */

// Types
export * from './types/index.js';
export * from './config/index.js';

// Providers
export {
  createProvider,
  isValidProviderType,
  normalizeProviderType,
  ClaudeCodeProvider,
  CursorCLIProvider,
  CodexCLIProvider,
} from './providers/index.js';
export type {
  AIProvider,
  ProviderType,
  ProviderAlias,
  ProviderOptions,
  ProviderStatus,
  ProviderResponse,
  PromptType,
} from './providers/types.js';
export { PROVIDER_ALIASES, PROVIDER_CHOICES } from './providers/types.js';

// Git utilities
export {
  isGitRepository,
  getCurrentBranch,
  getGitStatus,
  getAllChangedFiles,
  hasChanges,
  getRemoteStatus,
} from './git/status.js';
export type { RemoteStatus } from './git/status.js';
export { generateTreeSummary, generateFullTreeSummary } from './git/tree.js';
export {
  getModifiedDiffs,
  getDiffContent,
  loadFileDiffs,
  formatModifiedDiffs,
  getDiffContentForFiles,
} from './git/diff.js';
export { planChunks, chunkFiles } from './git/chunk.js';
export type { Chunk, ChunkBudget } from './git/chunk.js';
export {
  computeClusters,
  packClusters,
  planClusteredChunks,
} from './git/cluster.js';
export type { Cluster } from './git/cluster.js';
export {
  detectSourceLanguage,
  extractImports,
  resolveImport,
  buildImportGraph,
} from './git/imports.js';
export type { SourceLanguage } from './git/imports.js';
export { loadSourceContents } from './git/source.js';
export { executeCommits, stageFiles } from './git/executor.js';

// Parsers
export { parseJsonResponse } from './parser/json.js';
export { parseDelimiterResponse, toDelimiterFormat } from './parser/delimiter.js';

// Jira utilities
export { extractJiraKeys, formatJiraKeys, hasJiraKeys } from './jira/extractor.js';

// Prompts
export { getPromptTemplate, getJsonSchema } from './prompts/templates.js';

// Utilities
export { logger, colors } from './utils/logger.js';
export { execCommand, execSimple } from './utils/exec.js';
export {
  validateTitleLength,
  normalizeCommits,
  isValidConventionalCommit,
} from './utils/validation.js';
