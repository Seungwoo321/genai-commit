import { describe, it, expect } from 'vitest';
import { generateTreeSummary } from '../../src/git/tree.js';

describe('generateTreeSummary', () => {
  it('should list files directly when count is below threshold', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const result = generateTreeSummary(files, 'M');

    expect(result).toContain('M src/a.ts');
    expect(result).toContain('M src/b.ts');
    expect(result).toContain('M src/c.ts');
  });

  it('should compress files when count exceeds threshold', () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/components/deep/file${i}.tsx`);
    const result = generateTreeSummary(files, 'M', { compressionThreshold: 10, treeDepth: 3 });

    expect(result).toContain('src/components/deep/');
    expect(result).toContain('15 files');
    expect(result).toContain('*.tsx');
  });

  it('should handle empty file list', () => {
    const result = generateTreeSummary([], 'M');
    expect(result).toBe('');
  });

  it('should handle different change types', () => {
    const files = ['new-file.ts'];

    expect(generateTreeSummary(files, 'A')).toContain('A new-file.ts');
    expect(generateTreeSummary(files, 'D')).toContain('D new-file.ts');
    expect(generateTreeSummary(files, '?')).toContain('? new-file.ts');
  });

  it('should group files by extension in compressed mode', () => {
    const files = [
      ...Array.from({ length: 8 }, (_, i) => `src/deep/path/comp${i}.tsx`),
      ...Array.from({ length: 4 }, (_, i) => `src/deep/path/style${i}.css`),
    ];
    const result = generateTreeSummary(files, 'M', { compressionThreshold: 10, treeDepth: 3 });

    expect(result).toContain('*.tsx');
    expect(result).toContain('*.css');
  });
});
