/**
 * Validation utilities
 */

import type { Commit } from '../types/commit.js';
import { logger } from './logger.js';

const MAX_TITLE_LENGTH = 72;

/**
 * Validate commit title length
 */
export function validateTitleLength(commits: Commit[]): void {
  commits.forEach((commit, i) => {
    if (commit.title.length > MAX_TITLE_LENGTH) {
      logger.warning(
        `Commit ${i + 1} title exceeds ${MAX_TITLE_LENGTH} chars (${commit.title.length} chars)`
      );
    }
  });
}

/**
 * Validate that files in commits exist in the valid files list
 */
export function validateFilesExist(
  commits: Commit[],
  validFiles: Set<string>
): void {
  commits.forEach((commit) => {
    commit.files.forEach((file) => {
      if (!validFiles.has(file)) {
        logger.warning(
          `File '${file}' not in change list (may be AI hallucination or deleted file)`
        );
      }
    });
  });
}

/**
 * Check if a string is a valid Conventional Commit title
 */
export function isValidConventionalCommit(title: string): boolean {
  const pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\([^)]+\))?:\s.+/;
  return pattern.test(title);
}
