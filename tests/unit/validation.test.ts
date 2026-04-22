import { describe, it, expect } from 'vitest';
import { normalizeCommits, isValidConventionalCommit } from '../../src/utils/validation.js';

describe('normalizeCommits', () => {
  it('keeps exact matches and reports full coverage', () => {
    const valid = new Set(['src/a.ts', 'src/b.ts']);
    const { commits, dropped, missing } = normalizeCommits(
      [{ files: ['src/a.ts', 'src/b.ts'], title: 'feat: x', message: '' }],
      valid
    );

    expect(commits[0].files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(dropped).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('expands directory-prefix entries to matching real files', () => {
    const valid = new Set([
      'rust/src/repo/mod.rs',
      'rust/src/repo/tasks.rs',
      'rust/src/repo/artifacts.rs',
    ]);
    const { commits, dropped, missing } = normalizeCommits(
      [{ files: ['rust/src/repo/'], title: 'feat: repo', message: '' }],
      valid
    );

    expect(commits[0].files.sort()).toEqual([
      'rust/src/repo/artifacts.rs',
      'rust/src/repo/mod.rs',
      'rust/src/repo/tasks.rs',
    ]);
    expect(dropped).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('strips legacy compressed labels and expands them', () => {
    const valid = new Set([
      'rust/src/routes/agents.rs',
      'rust/src/routes/tasks.rs',
    ]);
    const { commits, dropped, missing } = normalizeCommits(
      [
        {
          files: ['rust/src/routes/ [10 files: 10 *.rs]'],
          title: 'feat: routes',
          message: '',
        },
      ],
      valid
    );

    expect(commits[0].files.sort()).toEqual([
      'rust/src/routes/agents.rs',
      'rust/src/routes/tasks.rs',
    ]);
    expect(dropped).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('drops hallucinated entries that match no valid file', () => {
    const valid = new Set(['src/real.ts']);
    const { commits, dropped, missing } = normalizeCommits(
      [{ files: ['src/real.ts', 'src/fake.ts'], title: 'feat: x', message: '' }],
      valid
    );

    expect(commits[0].files).toEqual(['src/real.ts']);
    expect(dropped).toEqual(['src/fake.ts']);
    expect(missing).toEqual([]);
  });

  it('reports uncovered files as missing', () => {
    const valid = new Set(['src/a.ts', 'src/b.ts']);
    const { missing } = normalizeCommits(
      [{ files: ['src/a.ts'], title: 'feat: x', message: '' }],
      valid
    );
    expect(missing).toEqual(['src/b.ts']);
  });

  it('deduplicates files within a single commit', () => {
    const valid = new Set(['src/a.ts', 'src/b.ts']);
    const { commits } = normalizeCommits(
      [
        {
          files: ['src/a.ts', 'src/a.ts', 'src/b.ts'],
          title: 'feat: x',
          message: '',
        },
      ],
      valid
    );
    expect(commits[0].files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('handles multiple commits sharing coverage', () => {
    const valid = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const { commits, missing } = normalizeCommits(
      [
        { files: ['src/a.ts'], title: 'feat: a', message: '' },
        { files: ['src/b.ts', 'src/c.ts'], title: 'feat: bc', message: '' },
      ],
      valid
    );
    expect(commits[0].files).toEqual(['src/a.ts']);
    expect(commits[1].files).toEqual(['src/b.ts', 'src/c.ts']);
    expect(missing).toEqual([]);
  });

  it('resolves cross-commit duplicates first-commit-wins and reports them', () => {
    const valid = new Set(['src/a.ts', 'src/b.ts']);
    const { commits, duplicates, missing } = normalizeCommits(
      [
        { files: ['src/a.ts', 'src/b.ts'], title: 'feat: both', message: '' },
        { files: ['src/a.ts'], title: 'chore: a again', message: '' },
      ],
      valid
    );

    expect(commits).toHaveLength(1);
    expect(commits[0].title).toBe('feat: both');
    expect(commits[0].files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(duplicates).toEqual(['src/a.ts']);
    expect(missing).toEqual([]);
  });

  it('filters out commits that become empty after normalization', () => {
    const valid = new Set(['src/a.ts']);
    const { commits, dropped } = normalizeCommits(
      [
        { files: ['src/a.ts'], title: 'feat: a', message: '' },
        { files: ['src/fake.ts'], title: 'feat: ghost', message: '' },
      ],
      valid
    );

    expect(commits).toHaveLength(1);
    expect(commits[0].title).toBe('feat: a');
    expect(dropped).toEqual(['src/fake.ts']);
  });
});

describe('isValidConventionalCommit', () => {
  it('accepts typical conventional commit titles', () => {
    expect(isValidConventionalCommit('feat: add x')).toBe(true);
    expect(isValidConventionalCommit('fix(core): handle null')).toBe(true);
  });

  it('rejects non-conventional titles', () => {
    expect(isValidConventionalCommit('add something')).toBe(false);
    expect(isValidConventionalCommit('unknown: whatever')).toBe(false);
  });
});
