/**
 * Auto-confirm (`--yes`) tests for runInteractiveLoop.
 *
 * The `--yes` branch is an early-return added before the interactive while loop:
 *   - missing coverage  ⇒ `cancelled`, exit non-zero from caller, no commit attempt
 *   - clean coverage    ⇒ `executeCommits` called once, no prompt, no retry
 *   - partial failure   ⇒ `cancelled` with `landedCount > 0`, no retry
 *
 * `executeCommits` is mocked because:
 *   - The autoConfirm path is independent of git — it just calls the executor
 *     once and returns. Spinning up a real repo (as executor.test does) would
 *     test the executor again rather than the loop's gating.
 *   - We need to verify call count (= 1) and arguments shape; that's only
 *     observable via a mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInteractiveLoop } from '../../src/ui/interactive.js';
import type { AIProvider } from '../../src/providers/types.js';
import type { GencoConfig } from '../../src/config/types.js';

vi.mock('../../src/git/executor.js', () => ({
  executeCommits: vi.fn(),
}));

import { executeCommits } from '../../src/git/executor.js';

const executeCommitsMock = executeCommits as unknown as ReturnType<typeof vi.fn>;

function makeProvider(): AIProvider {
  // The autoConfirm path never invokes the provider. Returning a minimal stub
  // is enough — the test fails (cleanly) if the loop ever calls it.
  return {
    name: 'stub',
    generate: vi.fn(),
    parseResponse: vi.fn(),
  } as unknown as AIProvider;
}

function makeConfig(): GencoConfig {
  return {} as GencoConfig;
}

describe('runInteractiveLoop with autoConfirm', () => {
  beforeEach(() => {
    executeCommitsMock.mockReset();
  });

  it('returns committed and calls executeCommits exactly once on clean coverage', async () => {
    executeCommitsMock.mockResolvedValueOnce({ ok: true, successCount: 2 });

    const commits = [
      { title: 'feat: a', message: 'm', files: ['a.ts'] },
      { title: 'feat: b', message: 'm', files: ['b.ts'] },
    ];

    const result = await runInteractiveLoop({
      provider: makeProvider(),
      initialCommits: commits,
      initialResponse: '',
      validFiles: new Set(['a.ts', 'b.ts']),
      originalInput: '',
      initialCoverage: { missing: [] },
      config: makeConfig(),
      autoConfirm: true,
    });

    expect(result.status).toBe('committed');
    expect(result.landedCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(executeCommitsMock).toHaveBeenCalledTimes(1);
    expect(executeCommitsMock).toHaveBeenCalledWith(commits);
  });

  it('returns cancelled without calling executeCommits when coverage has missing files', async () => {
    const result = await runInteractiveLoop({
      provider: makeProvider(),
      initialCommits: [{ title: 'feat: a', message: 'm', files: ['a.ts'] }],
      initialResponse: '',
      validFiles: new Set(['a.ts', 'b.ts']),
      originalInput: '',
      initialCoverage: { missing: ['b.ts'] }, // gap
      config: makeConfig(),
      autoConfirm: true,
    });

    expect(result.status).toBe('cancelled');
    expect(result.landedCount).toBe(0);
    expect(executeCommitsMock).not.toHaveBeenCalled();
  });

  it('returns cancelled with landedCount > 0 on partial failure and does not retry', async () => {
    executeCommitsMock.mockResolvedValueOnce({
      ok: false,
      successCount: 1,
      failure: { kind: 'hook', message: 'pre-commit blocked' },
    });

    const commits = [
      { title: 'feat: a', message: 'm', files: ['a.ts'] },
      { title: 'feat: b', message: 'm', files: ['b.ts'] },
    ];

    const result = await runInteractiveLoop({
      provider: makeProvider(),
      initialCommits: commits,
      initialResponse: '',
      validFiles: new Set(['a.ts', 'b.ts']),
      originalInput: '',
      initialCoverage: { missing: [] },
      config: makeConfig(),
      autoConfirm: true,
    });

    expect(result.status).toBe('cancelled');
    expect(result.landedCount).toBe(1);
    expect(result.totalCount).toBe(2);
    // No retry — single attempt only in autoConfirm mode.
    expect(executeCommitsMock).toHaveBeenCalledTimes(1);
  });
});
