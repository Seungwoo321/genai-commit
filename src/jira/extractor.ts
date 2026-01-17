/**
 * Jira key extraction utilities
 */

// Pattern to match Jira issue keys (e.g., AS-123, Proj-456, abc123-789)
const JIRA_KEY_PATTERN = /[A-Za-z0-9]+-\d+/g;

/**
 * Extract the last Jira key from a URL path or text
 * @param input URL or text containing Jira keys
 * @returns Array with the last Jira key found (for path-based extraction)
 */
export function extractJiraKeys(input: string): string[] {
  const matches = input.match(JIRA_KEY_PATTERN);
  if (!matches) {
    return [];
  }
  // Return only the last match (path-based: last segment is the ticket)
  return [matches[matches.length - 1]];
}

/**
 * Format multiple Jira keys as comma-separated string
 */
export function formatJiraKeys(keys: string[]): string {
  return keys.join(', ');
}

/**
 * Check if a string contains valid Jira keys
 */
export function hasJiraKeys(input: string): boolean {
  return JIRA_KEY_PATTERN.test(input);
}

/**
 * Validate if a string is a valid Jira key
 */
export function isValidJiraKey(key: string): boolean {
  const pattern = /^[A-Za-z0-9]+-\d+$/;
  return pattern.test(key);
}
