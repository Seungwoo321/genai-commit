/**
 * gencommit - AI-powered commit message generator
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
  ClaudeCodeProvider,
  CursorCLIProvider,
} from './providers/index.js';
export type {
  AIProvider,
  ProviderType,
  ProviderOptions,
  ProviderStatus,
  ProviderResponse,
  PromptType,
} from './providers/types.js';

// Git utilities
export {
  isGitRepository,
  getCurrentBranch,
  getGitStatus,
  getAllChangedFiles,
  hasChanges,
} from './git/status.js';
export { generateTreeSummary, generateFullTreeSummary } from './git/tree.js';
export { getModifiedDiffs, getDiffContent } from './git/diff.js';
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
  validateFilesExist,
  isValidConventionalCommit,
} from './utils/validation.js';
