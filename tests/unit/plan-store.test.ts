import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import {
  chunkDiffHash,
  freezePlan,
  savePlan,
  loadPlan,
  clearPlan,
  toChunk,
  pendingChunks,
  doneCount,
  markChunksDone,
  groupIntoBatches,
  isPlanFresh,
  type PersistedPlan,
} from '../../src/git/plan-store.js';
import type { Chunk } from '../../src/git/chunk.js';
import type { GitChange } from '../../src/types/git.js';

function change(
  file: string,
  status: GitChange['status'] = 'M',
  from?: string
): GitChange {
  return from ? { file, status, from } : { file, status };
}

function chunkOf(index: number, changes: GitChange[]): Chunk {
  return { index, changes, estimatedDiffSize: 0, estimatedTreeSize: 0 };
}

describe('chunkDiffHash', () => {
  it('is independent of in-chunk ordering', () => {
    const a = [change('src/a.ts'), change('src/b.ts')];
    const b = [change('src/b.ts'), change('src/a.ts')];
    const diffs = new Map([
      ['src/a.ts', 'diffA'],
      ['src/b.ts', 'diffB'],
    ]);
    expect(chunkDiffHash(a, diffs)).toBe(chunkDiffHash(b, diffs));
  });

  it('changes when a file diff content changes', () => {
    const changes = [change('src/a.ts')];
    const before = chunkDiffHash(changes, new Map([['src/a.ts', 'v1']]));
    const after = chunkDiffHash(changes, new Map([['src/a.ts', 'v2']]));
    expect(before).not.toBe(after);
  });

  it('factors in the rename source path', () => {
    const renamed = [change('src/new.ts', 'R', 'src/old.ts')];
    const plain = [change('src/new.ts', 'R')];
    const diffs = new Map([['src/new.ts', 'd']]);
    expect(chunkDiffHash(renamed, diffs)).not.toBe(chunkDiffHash(plain, diffs));
  });
});

describe('freezePlan', () => {
  it('marks every chunk pending and records metadata', () => {
    const chunks = [
      chunkOf(0, [change('src/a.ts')]),
      chunkOf(1, [change('src/b.ts')]),
    ];
    const diffs = new Map([
      ['src/a.ts', 'da'],
      ['src/b.ts', 'db'],
    ]);
    const plan = freezePlan(chunks, 'cluster', 5, diffs);

    expect(plan.version).toBe(1);
    expect(plan.strategy).toBe('cluster');
    expect(plan.batchSize).toBe(5);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks.every((c) => c.status === 'pending')).toBe(true);
    expect(plan.chunks[0].diffHash).toBe(chunkDiffHash(chunks[0].changes, diffs));
    expect(plan.chunks[0].index).toBe(0);
    expect(typeof plan.createdAt).toBe('string');
  });
});

describe('toChunk', () => {
  it('reconstructs an executable Chunk without status/hash', () => {
    const plan = freezePlan(
      [chunkOf(3, [change('src/a.ts')])],
      'directory',
      1,
      new Map([['src/a.ts', 'd']])
    );
    const restored = toChunk(plan.chunks[0]);
    expect(restored).toEqual({
      index: 3,
      changes: [change('src/a.ts')],
      estimatedDiffSize: 0,
      estimatedTreeSize: 0,
    });
    expect('status' in restored).toBe(false);
    expect('diffHash' in restored).toBe(false);
  });
});

describe('pendingChunks / doneCount / markChunksDone', () => {
  function plan(): PersistedPlan {
    return freezePlan(
      [
        chunkOf(0, [change('a.ts')]),
        chunkOf(1, [change('b.ts')]),
        chunkOf(2, [change('c.ts')]),
      ],
      'cluster',
      1,
      new Map([
        ['a.ts', 'da'],
        ['b.ts', 'db'],
        ['c.ts', 'dc'],
      ])
    );
  }

  it('reports all pending and zero done initially', () => {
    const p = plan();
    expect(pendingChunks(p)).toHaveLength(3);
    expect(doneCount(p)).toBe(0);
  });

  it('marks the given indices done and leaves the rest pending', () => {
    const p = plan();
    markChunksDone(p, [0, 2]);
    expect(doneCount(p)).toBe(2);
    expect(pendingChunks(p).map((c) => c.index)).toEqual([1]);
    expect(p.chunks.find((c) => c.index === 0)?.status).toBe('done');
    expect(p.chunks.find((c) => c.index === 1)?.status).toBe('pending');
  });
});

describe('groupIntoBatches', () => {
  it('splits into contiguous batches of the given size', () => {
    expect(groupIntoBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single batch when size covers everything', () => {
    expect(groupIntoBatches([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('treats a non-positive size as one batch of all items', () => {
    expect(groupIntoBatches([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });

  it('returns no batches for an empty list', () => {
    expect(groupIntoBatches([], 3)).toEqual([]);
  });
});

describe('isPlanFresh', () => {
  const diffs = new Map([
    ['a.ts', 'da'],
    ['b.ts', 'db'],
  ]);

  function freshPlan(): PersistedPlan {
    return freezePlan(
      [chunkOf(0, [change('a.ts'), change('b.ts')])],
      'cluster',
      1,
      diffs
    );
  }

  it('is fresh when the changeset and diffs match the frozen plan', () => {
    const plan = freshPlan();
    expect(isPlanFresh(plan, [change('a.ts'), change('b.ts')], diffs)).toBe(true);
  });

  it('is stale when a file appeared that the plan never saw', () => {
    const plan = freshPlan();
    const current = [change('a.ts'), change('b.ts'), change('new.ts')];
    const currentDiffs = new Map(diffs).set('new.ts', 'dn');
    expect(isPlanFresh(plan, current, currentDiffs)).toBe(false);
  });

  it('is stale when a pending chunk file is gone from the tree', () => {
    const plan = freshPlan();
    expect(isPlanFresh(plan, [change('a.ts')], new Map([['a.ts', 'da']]))).toBe(
      false
    );
  });

  it('is stale when a pending chunk file diff drifted', () => {
    const plan = freshPlan();
    const drifted = new Map([
      ['a.ts', 'da'],
      ['b.ts', 'CHANGED'],
    ]);
    expect(isPlanFresh(plan, [change('a.ts'), change('b.ts')], drifted)).toBe(
      false
    );
  });

  it('ignores files belonging to already-done chunks', () => {
    const plan = freezePlan(
      [chunkOf(0, [change('a.ts')]), chunkOf(1, [change('b.ts')])],
      'cluster',
      1,
      diffs
    );
    markChunksDone(plan, [0]);
    // a.ts (done chunk) is gone from the tree; only the pending b.ts remains.
    expect(isPlanFresh(plan, [change('b.ts')], new Map([['b.ts', 'db']]))).toBe(
      true
    );
  });
});

describe('plan persistence under the git directory', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'genai-plan-'));
    const git = simpleGit(root);
    await git.init();
    await git.addConfig('user.email', 'test@example.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    await git.commit(['init'], undefined, { '--allow-empty': null });
  });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  function samplePlan(): PersistedPlan {
    return freezePlan(
      [chunkOf(0, [change('a.ts')])],
      'cluster',
      1,
      new Map([['a.ts', 'da']])
    );
  }

  it('round-trips a saved plan', async () => {
    const plan = samplePlan();
    await savePlan(plan, root);
    const loaded = await loadPlan(root);
    expect(loaded).toEqual(plan);
  });

  it('stores the plan inside .git, invisible to the working tree', async () => {
    await savePlan(samplePlan(), root);

    const raw = await readFile(
      join(root, '.git', 'genai-commit', 'plan.json'),
      'utf8'
    );
    expect(JSON.parse(raw).strategy).toBe('cluster');

    const status = await simpleGit(root).raw(['status', '--porcelain']);
    expect(status).not.toContain('plan.json');
    expect(status).not.toContain('genai-commit');
  });

  it('returns null when no plan exists', async () => {
    expect(await loadPlan(root)).toBeNull();
  });

  it('returns null on a version mismatch', async () => {
    await savePlan(samplePlan(), root);
    const path = join(root, '.git', 'genai-commit', 'plan.json');
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...parsed, version: 999 }), 'utf8');
    expect(await loadPlan(root)).toBeNull();
  });

  it('clears a saved plan', async () => {
    await savePlan(samplePlan(), root);
    expect(await loadPlan(root)).not.toBeNull();
    await clearPlan(root);
    expect(await loadPlan(root)).toBeNull();
  });
});
