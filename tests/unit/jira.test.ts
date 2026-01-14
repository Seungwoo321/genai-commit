import { describe, it, expect } from 'vitest';
import { extractJiraKeys, formatJiraKeys, hasJiraKeys, isValidJiraKey } from '../../src/jira/extractor.js';

describe('extractJiraKeys', () => {
  it('should extract single Jira key from URL', () => {
    const url = 'https://company.atlassian.net/browse/PROJ-123';
    const keys = extractJiraKeys(url);

    expect(keys).toEqual(['PROJ-123']);
  });

  it('should extract multiple Jira keys', () => {
    const input = 'https://jira.com/PROJ-123, https://jira.com/PROJ-456';
    const keys = extractJiraKeys(input);

    expect(keys).toContain('PROJ-123');
    expect(keys).toContain('PROJ-456');
  });

  it('should deduplicate keys', () => {
    const input = 'PROJ-123 PROJ-123 PROJ-123';
    const keys = extractJiraKeys(input);

    expect(keys).toEqual(['PROJ-123']);
  });

  it('should return empty array for no matches', () => {
    const keys = extractJiraKeys('no jira keys here');

    expect(keys).toEqual([]);
  });

  it('should handle various Jira key formats', () => {
    const input = 'AS-1 ABC-123 LONGPROJECT-99999';
    const keys = extractJiraKeys(input);

    expect(keys).toContain('AS-1');
    expect(keys).toContain('ABC-123');
    expect(keys).toContain('LONGPROJECT-99999');
  });
});

describe('formatJiraKeys', () => {
  it('should format single key', () => {
    expect(formatJiraKeys(['PROJ-123'])).toBe('PROJ-123');
  });

  it('should format multiple keys with comma separator', () => {
    expect(formatJiraKeys(['PROJ-123', 'PROJ-456'])).toBe('PROJ-123, PROJ-456');
  });

  it('should handle empty array', () => {
    expect(formatJiraKeys([])).toBe('');
  });
});

describe('hasJiraKeys', () => {
  it('should return true for string with Jira key', () => {
    expect(hasJiraKeys('Fix for PROJ-123')).toBe(true);
  });

  it('should return false for string without Jira key', () => {
    expect(hasJiraKeys('No jira key here')).toBe(false);
  });
});

describe('isValidJiraKey', () => {
  it('should validate correct Jira key', () => {
    expect(isValidJiraKey('PROJ-123')).toBe(true);
    expect(isValidJiraKey('AB-1')).toBe(true);
  });

  it('should reject invalid Jira key', () => {
    expect(isValidJiraKey('proj-123')).toBe(false);
    expect(isValidJiraKey('PROJ123')).toBe(false);
    expect(isValidJiraKey('PROJ-')).toBe(false);
  });
});
