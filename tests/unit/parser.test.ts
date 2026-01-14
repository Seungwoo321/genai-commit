import { describe, it, expect } from 'vitest';
import { parseDelimiterResponse } from '../../src/parser/delimiter.js';
import { parseJsonResponse } from '../../src/parser/json.js';

describe('parseDelimiterResponse', () => {
  it('should parse single commit block', () => {
    const input = `===COMMIT===
FILES: src/index.ts
TITLE: feat(core): add new feature
MESSAGE: Added new feature implementation`;

    const result = parseDelimiterResponse(input);

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].files).toEqual(['src/index.ts']);
    expect(result.commits[0].title).toBe('feat(core): add new feature');
    expect(result.commits[0].message).toBe('Added new feature implementation');
  });

  it('should parse multiple commit blocks', () => {
    const input = `===COMMIT===
FILES: src/a.ts, src/b.ts
TITLE: feat(module): add module A and B
MESSAGE: Implemented modules
===COMMIT===
FILES: tests/a.test.ts
TITLE: test(module): add tests
MESSAGE: Added unit tests`;

    const result = parseDelimiterResponse(input);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.commits[1].files).toEqual(['tests/a.test.ts']);
  });

  it('should throw error for empty response', () => {
    expect(() => parseDelimiterResponse('')).toThrow();
  });

  it('should throw error for response without commits', () => {
    expect(() => parseDelimiterResponse('no commits here')).toThrow();
  });
});

describe('parseJsonResponse', () => {
  it('should parse valid JSON response', () => {
    const input = JSON.stringify({
      commits: [
        {
          files: ['src/index.ts'],
          title: 'feat: add feature',
          message: 'Implementation details',
        },
      ],
    });

    const result = parseJsonResponse(input);

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].title).toBe('feat: add feature');
  });

  it('should throw error for invalid JSON', () => {
    expect(() => parseJsonResponse('not json')).toThrow();
  });

  it('should throw error for missing commits array', () => {
    expect(() => parseJsonResponse('{}')).toThrow();
  });
});
