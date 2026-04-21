import { describe, it, expect } from 'vitest';
import { generateTreeSummary, generateFullTreeSummary } from '../../src/git/tree.js';
import type { GitChange } from '../../src/types/git.js';

describe('generateTreeSummary', () => {
  it('lists files directly when count is small', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const result = generateTreeSummary(files, 'M');

    expect(result).toContain('M src/a.ts');
    expect(result).toContain('M src/b.ts');
    expect(result).toContain('M src/c.ts');
  });

  it('lists every file verbatim even for large sets (no compression)', () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/components/deep/file${i}.tsx`);
    const result = generateTreeSummary(files, 'M');

    for (const f of files) {
      expect(result).toContain(`M ${f}`);
    }
    // Never emit the legacy compressed label — that was the root cause of
    // hallucinated paths reaching `git add`.
    expect(result).not.toMatch(/\[\s*\d+\s*files?[^\]]*\]/);
    expect(result).not.toMatch(/\*\.tsx/);
  });

  it('handles empty file list', () => {
    expect(generateTreeSummary([], 'M')).toBe('');
  });

  it('handles different change types', () => {
    const files = ['new-file.ts'];

    expect(generateTreeSummary(files, 'A')).toContain('A new-file.ts');
    expect(generateTreeSummary(files, 'D')).toContain('D new-file.ts');
    expect(generateTreeSummary(files, '?')).toContain('? new-file.ts');
  });

  it('includes both paths for renames', () => {
    const files = ['new.ts'];
    const renameMap = new Map([['new.ts', 'old.ts']]);
    const result = generateTreeSummary(files, 'R', renameMap);
    expect(result).toContain('R old.ts → new.ts');
  });
});

describe('generateFullTreeSummary', () => {
  it('lists every changed file with its status prefix', () => {
    const changes: GitChange[] = [
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/b.ts', status: 'A' },
      { file: 'src/c.ts', status: 'D' },
    ];
    const out = generateFullTreeSummary('main', changes);

    expect(out).toContain('M src/a.ts');
    expect(out).toContain('A src/b.ts');
    expect(out).toContain('D src/c.ts');
    expect(out).toContain('Branch: main');
    expect(out).toContain('Total: 3 files');
    expect(out).not.toMatch(/\[\s*\d+\s*files?[^\]]*\]/);
  });

  it('truncates with explicit marker when exceeding maxTreeSize', () => {
    const changes: GitChange[] = Array.from({ length: 200 }, (_, i) => ({
      file: `pkg/module${i}/file.ts`,
      status: 'M' as const,
    }));
    const out = generateFullTreeSummary('main', changes, { maxTreeSize: 500 });

    expect(out.length).toBeLessThanOrEqual(500);
    expect(out).toMatch(/\[\.\.\. \d+ files omitted due to size limit/);
    // Must also warn the AI against inventing filenames.
    expect(out).toContain('DO NOT invent filenames');
  });

  it('reports an accurate omitted count (structural lines do not inflate it)', () => {
    const changes: GitChange[] = Array.from({ length: 200 }, (_, i) => ({
      file: `pkg/module${i}/file.ts`,
      status: 'M' as const,
    }));
    const out = generateFullTreeSummary('main', changes, { maxTreeSize: 500 });

    const keptFiles = (out.match(/^M pkg\/module\d+\/file\.ts$/gm) ?? []).length;
    const match = out.match(/\[\.\.\. (\d+) files omitted/);
    expect(match).not.toBeNull();
    const reported = Number(match![1]);

    expect(keptFiles + reported).toBe(200);
  });

  it('does not exceed maxTreeSize when only structural tail lines are dropped', () => {
    // One file whose summary still overflows a very tight cap because the
    // CHANGE SUMMARY header alone is large. The contract is "≤ maxSize",
    // regardless of whether any actual file lines were dropped.
    const changes: GitChange[] = [{ file: 'x.ts', status: 'M' }];
    const full = generateFullTreeSummary('main', changes, { maxTreeSize: 100000 });
    const cap = full.length - 5;

    const out = generateFullTreeSummary('main', changes, { maxTreeSize: cap });
    expect(out.length).toBeLessThanOrEqual(cap);
  });

  it('returns the full output when under the size cap', () => {
    const changes: GitChange[] = [
      { file: 'x.ts', status: 'M' },
    ];
    const out = generateFullTreeSummary('main', changes, { maxTreeSize: 100000 });
    expect(out).toContain('M x.ts');
    expect(out).not.toContain('files omitted');
  });
});
