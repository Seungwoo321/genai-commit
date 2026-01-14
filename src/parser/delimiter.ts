/**
 * Delimiter-based response parser for Cursor CLI
 * Parses ===COMMIT=== delimited format
 */

import type { Commit, CommitResult } from '../types/commit.js';

const COMMIT_DELIMITER = '===COMMIT===';

/**
 * Parse a single commit block
 */
function parseCommitBlock(block: string): Commit | null {
  const lines = block.split('\n');
  let files = '';
  let title = '';
  let message = '';

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('FILES:')) {
      files = trimmedLine.substring(6).trim();
    } else if (trimmedLine.startsWith('TITLE:')) {
      title = trimmedLine.substring(6).trim();
    } else if (trimmedLine.startsWith('MESSAGE:')) {
      message = trimmedLine.substring(8).trim();
    }
  }

  // Validate required fields
  if (!files || !title) {
    return null;
  }

  // Parse files as comma-separated list
  const fileList = files
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  if (fileList.length === 0) {
    return null;
  }

  return {
    files: fileList,
    title,
    message: message || '',
  };
}

/**
 * Parse delimiter-based response from Cursor CLI
 */
export function parseDelimiterResponse(raw: string): CommitResult {
  const commits: Commit[] = [];

  // Split by delimiter and skip content before first delimiter
  const blocks = raw.split(COMMIT_DELIMITER).slice(1);

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (trimmedBlock) {
      const commit = parseCommitBlock(trimmedBlock);
      if (commit) {
        commits.push(commit);
      }
    }
  }

  if (commits.length === 0) {
    throw new Error(
      `No valid commits found in response. Raw response:\n${raw.substring(0, 500)}...`
    );
  }

  return { commits };
}

/**
 * Convert commits to delimiter format (for debugging/testing)
 */
export function toDelimiterFormat(commits: Commit[]): string {
  return commits
    .map(
      (c) =>
        `${COMMIT_DELIMITER}\nFILES: ${c.files.join(', ')}\nTITLE: ${c.title}\nMESSAGE: ${c.message}`
    )
    .join('\n');
}
