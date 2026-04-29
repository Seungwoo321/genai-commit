import { describe, it, expect, vi } from 'vitest';
import type { Ora } from 'ora';
import {
  runCrossChunkMerge,
  shouldRunMerge,
} from '../../src/commands/merge.js';
import type {
  AIProvider,
  PromptType,
  ProviderResponse,
} from '../../src/providers/types.js';
import type { Commit, CommitResult } from '../../src/types/commit.js';
import type { GencoConfig } from '../../src/config/types.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

const CONFIG: GencoConfig = { ...DEFAULT_CONFIG };

function mockSpinner(): Ora {
  return { text: '' } as unknown as Ora;
}

interface MockProviderOptions {
  /** Pre-baked response. If omitted, throws to simulate AI failure. */
  response?: CommitResult;
  /** Return raw JSON instead of parsed; used to test parse failure. */
  rawOverride?: string;
  /** Force generate() to throw. */
  throwOnGenerate?: boolean;
  /** Force parseResponse() to throw. */
  throwOnParse?: boolean;
}

function mockProvider(opts: MockProviderOptions = {}): AIProvider {
  const generate = vi.fn(
    async (_input: string, _promptType: PromptType): Promise<ProviderResponse> => {
      if (opts.throwOnGenerate) throw new Error('AI call failed');
      return { raw: opts.rawOverride ?? JSON.stringify(opts.response ?? { commits: [] }) };
    }
  );
  const parseResponse = vi.fn((response: ProviderResponse): CommitResult => {
    if (opts.throwOnParse) throw new Error('parse failed');
    return JSON.parse(response.raw);
  });
  return {
    name: 'claude-code',
    generate,
    parseResponse,
    login: vi.fn(),
    status: vi.fn(),
    getSessionId: vi.fn(),
    clearSession: vi.fn(),
  } as unknown as AIProvider;
}

describe('shouldRunMerge', () => {
  const c = (file: string): Commit => ({
    files: [file],
    title: 'chore: x',
    message: 'x',
  });

  it('skips when only one chunk was produced (nothing cross-chunk to merge)', () => {
    expect(shouldRunMerge(1, [c('a.ts'), c('b.ts')])).toBe(false);
  });

  it('skips when only one commit total exists', () => {
    expect(shouldRunMerge(3, [c('a.ts')])).toBe(false);
  });

  it('runs when multiple chunks produced multiple commits', () => {
    expect(shouldRunMerge(2, [c('a.ts'), c('b.ts')])).toBe(true);
  });
});

describe('runCrossChunkMerge', () => {
  const validFiles = new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts']);
  const inputCommits: Commit[] = [
    { files: ['a.ts', 'b.ts'], title: 'feat(auth): part 1', message: 'auth' },
    { files: ['c.ts', 'd.ts'], title: 'feat(auth): part 2', message: 'auth' },
  ];

  it('returns merged commits when AI output is valid and covers every input file', async () => {
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            title: 'feat(auth): unified change',
            message: 'merged',
          },
        ],
      },
    });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).not.toBeNull();
    expect(result!.commits).toHaveLength(1);
    expect(result!.commits[0].files.sort()).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
      'd.ts',
    ]);
  });

  it('uses the merge prompt type, not commit', async () => {
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            title: 'feat: merged',
            message: '...',
          },
        ],
      },
    });
    await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.any(String),
      'merge'
    );
  });

  it('rolls back to null when the merge drops a covered file', async () => {
    // Output omits c.ts and d.ts — coverage gap, must roll back.
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts'],
            title: 'feat(auth): unified change',
            message: 'merged',
          },
        ],
      },
    });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('rolls back when a merged title exceeds 72 characters', async () => {
    const longTitle =
      'feat(auth): this is a needlessly verbose merged title that absolutely will exceed seventy-two characters in length for sure';
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            title: longTitle,
            message: 'merged',
          },
        ],
      },
    });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('rolls back when the AI fabricates a path not in the change set', async () => {
    // 'fabricated.ts' is not in validFiles → normalizeCommits drops it,
    // then a.ts and b.ts coverage holes appear → missing > 0 → rollback.
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['fabricated.ts'],
            title: 'feat: bogus',
            message: 'invented',
          },
          {
            files: ['c.ts', 'd.ts'],
            title: 'feat(other): real',
            message: 'ok',
          },
        ],
      },
    });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('rolls back when the AI call throws', async () => {
    const provider = mockProvider({ throwOnGenerate: true });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('rolls back when the response is unparseable', async () => {
    const provider = mockProvider({ throwOnParse: true });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('rolls back when the merge produces zero commits', async () => {
    const provider = mockProvider({ response: { commits: [] } });

    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    expect(result).toBeNull();
  });

  it('serializes the input commits as JSON in the prompt body', async () => {
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            title: 'feat: x',
            message: 'x',
          },
        ],
      },
    });
    await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );

    const sent = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(sent).toContain('TITLE_LANG');
    expect(sent).toContain('CROSS-CHUNK MERGE');
    expect(sent).toContain('"feat(auth): part 1"');
    expect(sent).toContain('"a.ts"');
  });

  it('preserves the merge input/raw artifacts in the result', async () => {
    const provider = mockProvider({
      response: {
        commits: [
          {
            files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
            title: 'feat: merged',
            message: 'm',
          },
        ],
      },
    });
    const result = await runCrossChunkMerge(
      provider,
      CONFIG,
      inputCommits,
      validFiles,
      mockSpinner()
    );
    expect(result!.input).toContain('CROSS-CHUNK MERGE');
    expect(result!.raw).toContain('feat: merged');
  });
});
