/**
 * JSON response parser for Claude Code CLI
 */

import type { Commit, CommitResult } from '../types/commit.js';

/**
 * Parse JSON response from Claude CLI
 */
export function parseJsonResponse(raw: string): CommitResult {
  try {
    const parsed = JSON.parse(raw);

    if (!parsed.commits || !Array.isArray(parsed.commits)) {
      throw new Error('Response does not contain commits array');
    }

    const commits: Commit[] = parsed.commits.map((c: Record<string, unknown>) => ({
      files: Array.isArray(c.files) ? c.files : [],
      title: String(c.title || ''),
      message: String(c.message || ''),
      jiraKey: c.jira_key ? String(c.jira_key) : undefined,
    }));

    // Filter out invalid commits
    const validCommits = commits.filter(
      (c) => c.files.length > 0 && c.title.length > 0
    );

    if (validCommits.length === 0) {
      throw new Error('No valid commits found in response');
    }

    return { commits: validCommits };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON response: ${raw.substring(0, 200)}...`);
    }
    throw error;
  }
}
