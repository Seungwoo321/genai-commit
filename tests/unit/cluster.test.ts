import { describe, it, expect } from 'vitest';
import {
  computeClusters,
  packClusters,
  planClusteredChunks,
} from '../../src/git/cluster.js';
import type { ChunkBudget } from '../../src/git/chunk.js';
import type { GitChange } from '../../src/types/git.js';

const ROOMY: ChunkBudget = {
  maxDiffSize: 100_000,
  treeBudget: 100_000,
  safetyMargin: 0,
};

const TIGHT: ChunkBudget = {
  maxDiffSize: 600,
  treeBudget: 600,
  safetyMargin: 0,
};

function diffOf(file: string, size: number): [string, string] {
  return [file, 'X'.repeat(size)];
}

describe('computeClusters', () => {
  it('returns empty for an empty change set', () => {
    expect(computeClusters([], new Map(), new Map())).toEqual([]);
  });

  it('groups files connected through the import graph into one cluster', () => {
    const changes: GitChange[] = [
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/b.ts', status: 'M' },
      { file: 'src/c.ts', status: 'M' },
    ];
    const graph = new Map([
      ['src/a.ts', new Set(['src/b.ts'])],
      ['src/b.ts', new Set(['src/c.ts'])],
      ['src/c.ts', new Set<string>()],
    ]);

    const clusters = computeClusters(changes, new Map(), graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].changes.map((c) => c.file)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });

  it('treats the graph as undirected for component discovery', () => {
    const changes: GitChange[] = [
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/b.ts', status: 'M' },
    ];
    // a -> b only; b has no outgoing edges, but still in same component.
    const graph = new Map([
      ['src/a.ts', new Set(['src/b.ts'])],
      ['src/b.ts', new Set<string>()],
    ]);

    const clusters = computeClusters(changes, new Map(), graph);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].changes).toHaveLength(2);
  });

  it('emits singleton clusters for files with no edges', () => {
    const changes: GitChange[] = [
      { file: 'src/lonely.ts', status: 'M' },
      { file: 'src/standalone.ts', status: 'A' },
    ];
    const graph = new Map([
      ['src/lonely.ts', new Set<string>()],
      ['src/standalone.ts', new Set<string>()],
    ]);

    const clusters = computeClusters(changes, new Map(), graph);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.changes.length === 1)).toBe(true);
  });

  it('separates disconnected components into distinct clusters', () => {
    const changes: GitChange[] = [
      { file: 'auth/a.ts', status: 'M' },
      { file: 'auth/b.ts', status: 'M' },
      { file: 'billing/x.ts', status: 'M' },
      { file: 'billing/y.ts', status: 'M' },
    ];
    const graph = new Map([
      ['auth/a.ts', new Set(['auth/b.ts'])],
      ['auth/b.ts', new Set<string>()],
      ['billing/x.ts', new Set(['billing/y.ts'])],
      ['billing/y.ts', new Set<string>()],
    ]);

    const clusters = computeClusters(changes, new Map(), graph);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].changes.map((c) => c.file)).toEqual([
      'auth/a.ts',
      'auth/b.ts',
    ]);
    expect(clusters[1].changes.map((c) => c.file)).toEqual([
      'billing/x.ts',
      'billing/y.ts',
    ]);
  });

  it('computes diff and tree sizes per cluster', () => {
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
    ];
    const diffs = new Map([diffOf('a.ts', 100), diffOf('b.ts', 250)]);
    const graph = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set<string>()],
    ]);

    const [cluster] = computeClusters(changes, diffs, graph);
    expect(cluster.diffSize).toBe(350);
    expect(cluster.treeSize).toBeGreaterThan(0);
  });

  it('produces deterministic output regardless of input order', () => {
    const changes1: GitChange[] = [
      { file: 'src/z.ts', status: 'M' },
      { file: 'src/a.ts', status: 'M' },
      { file: 'src/m.ts', status: 'M' },
    ];
    const changes2 = [...changes1].reverse();

    const graph = new Map([
      ['src/z.ts', new Set(['src/a.ts'])],
      ['src/a.ts', new Set<string>()],
      ['src/m.ts', new Set<string>()],
    ]);

    const r1 = computeClusters(changes1, new Map(), graph);
    const r2 = computeClusters(changes2, new Map(), graph);
    expect(r1).toEqual(r2);

    // Connected component (a, z) listed first by lowest file path; m alone after.
    expect(r1[0].changes.map((c) => c.file)).toEqual(['src/a.ts', 'src/z.ts']);
    expect(r1[1].changes.map((c) => c.file)).toEqual(['src/m.ts']);
  });
});

describe('packClusters', () => {
  it('returns no chunks for an empty cluster list', () => {
    expect(packClusters([], new Map(), ROOMY)).toEqual([]);
  });

  it('packs every cluster into a single chunk when budget is roomy', () => {
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
      { file: 'c.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('a.ts', 100),
      diffOf('b.ts', 100),
      diffOf('c.ts', 100),
    ]);
    const graph = new Map([
      ['a.ts', new Set<string>()],
      ['b.ts', new Set<string>()],
      ['c.ts', new Set<string>()],
    ]);
    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, ROOMY);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].changes.map((c) => c.file).sort()).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('keeps a connected cluster intact when it fits in one chunk', () => {
    // Three files connected (a->b->c). Each file's diff is 150B; cluster
    // total is 450B. Budget cap is 600B (TIGHT) — fits in one chunk.
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
      { file: 'c.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('a.ts', 150),
      diffOf('b.ts', 150),
      diffOf('c.ts', 150),
    ]);
    const graph = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['c.ts'])],
      ['c.ts', new Set<string>()],
    ]);
    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, TIGHT);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].changes).toHaveLength(3);
  });

  it('decomposes an oversized cluster into singletons rather than dropping files', () => {
    // Connected cluster sums to 800B; cap (after margin 0) is 600B. The
    // cluster cannot fit even alone, so its files must split across chunks.
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
      { file: 'c.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('a.ts', 300),
      diffOf('b.ts', 300),
      diffOf('c.ts', 200),
    ]);
    const graph = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['c.ts'])],
      ['c.ts', new Set<string>()],
    ]);
    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, TIGHT);

    const allFiles = chunks.flatMap((c) => c.changes.map((x) => x.file));
    expect(allFiles.sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(chunks.length).toBeGreaterThan(1);
    // No chunk's diff exceeds the cap.
    for (const c of chunks) {
      expect(c.estimatedDiffSize).toBeLessThanOrEqual(TIGHT.maxDiffSize);
    }
  });

  it('emits a single oversized file in its own chunk rather than dropping it', () => {
    const changes: GitChange[] = [
      { file: 'small.ts', status: 'M' },
      { file: 'huge.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('small.ts', 100),
      diffOf('huge.ts', 5000),
    ]);
    const graph = new Map([
      ['small.ts', new Set<string>()],
      ['huge.ts', new Set<string>()],
    ]);
    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, TIGHT);

    const allFiles = chunks
      .flatMap((c) => c.changes.map((x) => x.file))
      .sort();
    expect(allFiles).toEqual(['huge.ts', 'small.ts']);
    const huge = chunks.find((c) =>
      c.changes.some((x) => x.file === 'huge.ts')
    )!;
    expect(huge.changes).toHaveLength(1);
  });

  it('covers every file exactly once across many disconnected files', () => {
    const changes: GitChange[] = Array.from({ length: 50 }, (_, i) => ({
      file: `file${i}.ts`,
      status: 'M' as const,
    }));
    const diffs = new Map(changes.map((c) => diffOf(c.file, 200)));
    const graph = new Map(changes.map((c) => [c.file, new Set<string>()]));

    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, TIGHT);

    const seen = new Set<string>();
    for (const chunk of chunks) {
      for (const c of chunk.changes) {
        expect(seen.has(c.file)).toBe(false);
        seen.add(c.file);
      }
    }
    expect(seen.size).toBe(50);
  });

  it('produces deterministic chunks for the same input', () => {
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
      { file: 'c.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('a.ts', 100),
      diffOf('b.ts', 200),
      diffOf('c.ts', 50),
    ]);
    const graph = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set<string>()],
      ['c.ts', new Set<string>()],
    ]);
    const clusters = computeClusters(changes, diffs, graph);
    const r1 = packClusters(clusters, diffs, ROOMY);
    const r2 = packClusters(clusters, diffs, ROOMY);
    expect(r1).toEqual(r2);
  });

  it('planClusteredChunks composes cluster + pack and keeps related files together', () => {
    // Two disjoint feature clusters across different directories. A pure
    // directory-based chunker would split them by depth/alpha order; the
    // import graph keeps each feature's files together regardless of path.
    const changes: GitChange[] = [
      { file: 'auth/login.ts', status: 'M' },
      { file: 'shared/auth-helpers.ts', status: 'M' },
      { file: 'billing/invoice.ts', status: 'M' },
      { file: 'shared/billing-helpers.ts', status: 'M' },
    ];
    const diffs = new Map([
      diffOf('auth/login.ts', 100),
      diffOf('shared/auth-helpers.ts', 100),
      diffOf('billing/invoice.ts', 100),
      diffOf('shared/billing-helpers.ts', 100),
    ]);
    const graph = new Map([
      ['auth/login.ts', new Set(['shared/auth-helpers.ts'])],
      ['shared/auth-helpers.ts', new Set<string>()],
      ['billing/invoice.ts', new Set(['shared/billing-helpers.ts'])],
      ['shared/billing-helpers.ts', new Set<string>()],
    ]);

    const chunks = planClusteredChunks(changes, diffs, graph, ROOMY);

    // All four fit in one chunk under ROOMY budget; the assertion that
    // matters is that an intra-cluster pair is never split when capacity
    // permits.
    expect(chunks).toHaveLength(1);
    const filesByCluster = new Map<string, string>();
    filesByCluster.set('auth/login.ts', 'auth');
    filesByCluster.set('shared/auth-helpers.ts', 'auth');
    filesByCluster.set('billing/invoice.ts', 'billing');
    filesByCluster.set('shared/billing-helpers.ts', 'billing');

    // Verify both members of each cluster co-exist in the same chunk.
    for (const cluster of ['auth', 'billing'] as const) {
      const members = [...filesByCluster.entries()]
        .filter(([, c]) => c === cluster)
        .map(([f]) => f);
      const containingChunks = members.map((m) =>
        chunks.findIndex((ch) => ch.changes.some((c) => c.file === m))
      );
      const unique = new Set(containingChunks);
      expect(unique.size).toBe(1);
    }
  });

  it('respects safety margin when fitting clusters', () => {
    // diffCap = 600 * (1 - 0.5) = 300. A 400B cluster cannot fit even alone
    // under the margin, so it gets split.
    const margin: ChunkBudget = {
      maxDiffSize: 600,
      treeBudget: 100_000,
      safetyMargin: 0.5,
    };
    const changes: GitChange[] = [
      { file: 'a.ts', status: 'M' },
      { file: 'b.ts', status: 'M' },
    ];
    const diffs = new Map([diffOf('a.ts', 200), diffOf('b.ts', 200)]);
    const graph = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set<string>()],
    ]);

    const clusters = computeClusters(changes, diffs, graph);
    const chunks = packClusters(clusters, diffs, margin);
    expect(chunks).toHaveLength(2);
  });
});
