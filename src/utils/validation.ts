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
 * Check if a commit file entry matches a valid file.
 * Handles both exact paths and directory-level paths from compressed tree summaries.
 * e.g. "node_modules/.pnpm" matches "node_modules/.pnpm/ws@8.20.0/.../index.js"
 */
function matchesFile(commitFile: string, validFile: string): boolean {
  if (commitFile === validFile) return true;
  // Directory match: commitFile is a prefix of validFile
  const dirPrefix = commitFile.endsWith('/') ? commitFile : commitFile + '/';
  return validFile.startsWith(dirPrefix);
}

/**
 * Validate that files in commits exist in the valid files list
 */
export function validateFilesExist(
  commits: Commit[],
  validFiles: Set<string>
): void {
  const validArray = [...validFiles];
  commits.forEach((commit) => {
    commit.files.forEach((file) => {
      const hasMatch = validFiles.has(file) || validArray.some((v) => matchesFile(file, v));
      if (!hasMatch) {
        logger.warning(
          `File '${file}' not in change list (may be AI hallucination or deleted file)`
        );
      }
    });
  });
}

/**
 * Find changed files not included in any commit
 * Returns the list of missing files so the caller can decide what to do
 */
export function findMissingFiles(
  commits: Commit[],
  validFiles: Set<string>
): string[] {
  const committedFiles: string[] = [];
  for (const commit of commits) {
    for (const file of commit.files) {
      committedFiles.push(file);
    }
  }

  const missing: string[] = [];
  for (const file of validFiles) {
    const isCovered = committedFiles.some((cf) => matchesFile(cf, file));
    if (!isCovered) {
      missing.push(file);
    }
  }

  return missing;
}

/**
 * Check if a string is a valid Conventional Commit title
 */
export function isValidConventionalCommit(title: string): boolean {
  const pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\([^)]+\))?:\s.+/;
  return pattern.test(title);
}
