/**
 * Jira key extraction utilities
 */

// Pattern to match Jira issue keys (e.g., AS-123, PROJ-456)
const JIRA_KEY_PATTERN = /[A-Z]+-\d+/g;

/**
 * Extract Jira keys from a URL or text
 * @param input URL or text containing Jira keys
 * @returns Array of unique Jira keys
 */
export function extractJiraKeys(input: string): string[] {
  const matches = input.match(JIRA_KEY_PATTERN);
  if (!matches) {
    return [];
  }
  // Remove duplicates
  return [...new Set(matches)];
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
  const pattern = /^[A-Z]+-\d+$/;
  return pattern.test(key);
}
