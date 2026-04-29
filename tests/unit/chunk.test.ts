import { describe, it, expect } from 'vitest';
import { planChunks, chunkFiles, type ChunkBudget } from '../../src/git/chunk.js';
import type { GitChange } from '../../src/types/git.js';

const TIGHT_BUDGET: ChunkBudget = {
  maxDiffSize: 600,
  treeBudget: 600,
  safetyMargin: 0,
};

const ROOMY_BUDGET: ChunkBudget = {
  maxDiffSize: 100_000,
  treeBudget: 100_000,
  safetyMargin: 0.1,
};

function diffOf(file: string, size: number): [string, string] {
  return [file, 'X'.repeat(size)];
}

describe('planChunks', () => {
  it('returns no chunks for an empty change list', () => {
    expect(planChunks([], new Map(), ROOMY_BUDGET)).toEqual([]);
  });

  it('packs every file into a single chunk when budget is roomy', () => {
    const changes: GitChange[] = [
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/b.ts', status: 'M' },
      { file: 'src/c.ts', status: 'A' },
    ];
    const diffs = new Map([
      diffOf('src/a.ts', 100),
      diffOf('src/b.ts', 100),
    ]);

    const chunks = planChunks(changes, diffs, ROOMY_BUDGET);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].changes.map((c) => c.file).sort()).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });

  it('splits across chunks when diff would overflow', () => {
    // Each file's diff is 250 bytes; cap is 600. Three files per pair would
    // be 750, so the split is 2 + 1.
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
      { file: 'c.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('a.ts', 250),
      diffOf('b.ts', 250),
      diffOf('c.ts', 250),
    ]);

    const chunks = planChunks(changes, diffs, TIGHT_BUDGET);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].changes).toHaveLength(2);
    expect(chunks[1].changes).toHaveLength(1);
  });

  it('covers every file exactly once across chunks', () => {
    const changes: GitChange[] = Array.from({ length: 50 }, (_, i) => ({
      file: `pkg/dir${i % 5}/file${i}.ts`,
      status: 'M' as const,
    }));
    const diffs = new Map(changes.map((c) => diffOf(c.file, 200)));

    const chunks = planChunks(changes, diffs, TIGHT_BUDGET);
    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const c of chunk.changes) {
        expect(seen.has(c.file)).toBe(false);
        seen.add(c.file);
      }
    }
    expect(seen.size).toBe(50);
  });

  it('emits an oversized single file in its own chunk rather than dropping it', () => {
    // A file whose diff alone exceeds the cap. The chunker must still
    // include it, otherwise coverage would gap and the commit flow would
    // block — exactly the bug this design eliminates.
    const changes: GitChange[] = [
      { file: 'small.ts', status: 'M' },
      { file: 'huge.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('small.ts', 100),
      diffOf('huge.ts', 5000),
    ]);

    const chunks = planChunks(changes, diffs, TIGHT_BUDGET);
    const allFiles = chunks.flatMap((c) => c.changes.map((x) => x.file)).sort();
    expect(allFiles).toEqual(['huge.ts', 'small.ts']);
    // huge.ts must be alone — adding small.ts to it would push diff past cap.
    const huge = chunks.find((c) => c.changes.some((x) => x.file === 'huge.ts'))!;
    expect(huge.changes).toHaveLength(1);
  });

  it('produces deterministic chunks for the same input', () => {
    const changes: GitChange[] = [
      { file: 'src/z.ts', status: 'M' },
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/m.ts', status: 'M' },
    ];
    const diffs = new Map(changes.map((c) => diffOf(c.file, 100)));

    const a = planChunks(changes, diffs, ROOMY_BUDGET);
    const b = planChunks(changes, diffs, ROOMY_BUDGET);
    expect(a).toEqual(b);
    // Sorted alphabetically within the same depth.
    expect(a[0].changes.map((c) => c.file)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('counts both sides of a rename for tree sizing', () => {
    const changes: GitChange[] = [
      { file: 'new.ts', status: 'R', from: 'old.ts' },
    ];
    const diffs = new Map<string, string>();

    const chunks = planChunks(changes, diffs, ROOMY_BUDGET);
    expect(chunks).toHaveLength(1);
    // Estimated tree size includes both paths plus the arrow markup.
    expect(chunks[0].estimatedTreeSize).toBeGreaterThan(
      'old.ts'.length + 'new.ts'.length
    );
  });

  it('treats files without a diff entry as zero-cost', () => {
    // Untracked files have no diff yet, so the diff map omits them. The
    // chunker must still place them.
    const changes: GitChange[] = [
      { file: 'untracked.ts', status: '?' },
    ];

    const chunks = planChunks(changes, new Map(), ROOMY_BUDGET);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].changes[0].file).toBe('untracked.ts');
    expect(chunks[0].estimatedDiffSize).toBe(0);
  });
});

describe('chunkFiles', () => {
  it('returns the post-rename path and the pre-rename path', () => {
    const chunk = {
      index: 0,
      changes: [
        { file: 'new.ts', status: 'R' as const, from: 'old.ts' },
        { file: 'plain.ts', status: 'M' as const },
      ],
      estimatedDiffSize: 0,
      estimatedTreeSize: 0,
    };
    expect(chunkFiles(chunk).sort()).toEqual(['new.ts', 'old.ts', 'plain.ts']);
  });
});
