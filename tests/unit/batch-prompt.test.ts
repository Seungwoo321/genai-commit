/**
 * Tests for the batch-count prompt and the commit-label parameterization.
 *
 * promptBatchCount drives an inquirer `list`, so inquirer is mocked here to
 * capture the choices it derives from the chunk count and to feed back a
 * selection without a TTY. The commit-label test drives the real promptAction
 * over PassThrough streams (the rest of the suite's pattern) to confirm a
 * batched run can relabel the [y] action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';

const promptMock = vi.fn();
vi.mock('inquirer', () => ({
  default: { prompt: (...args: unknown[]) => promptMock(...args) },
}));

import { promptBatchCount, promptAction } from '../../src/ui/interactive.js';

interface Choice {
  name: string;
  value: number;
}

describe('promptBatchCount', () => {
  beforeEach(() => {
    promptMock.mockReset();
  });

  it('offers "all at once" first and dedupes batch-size splits', async () => {
    let captured: Choice[] = [];
    promptMock.mockImplementationOnce((qs: Array<{ choices: Choice[] }>) => {
      captured = qs[0].choices;
      return Promise.resolve({ size: 20 });
    });

    const size = await promptBatchCount(20);
    expect(size).toBe(20);

    // First option is the all-at-once batch whose value is the chunk count.
    expect(captured[0].value).toBe(20);
    expect(captured[0].name).toContain('All at once');

    // 20 chunks → ceil(20/3)=7, ceil(20/5)=4, ceil(20/10)=2: all distinct.
    const values = captured.map((c) => c.value);
    expect(values).toContain(7);
    expect(values).toContain(4);
    expect(values).toContain(2);

    // A custom option (sentinel -1) is always last.
    expect(captured[captured.length - 1].value).toBe(-1);
  });

  it('returns the selected chunks-per-batch directly', async () => {
    promptMock.mockResolvedValueOnce({ size: 4 });
    expect(await promptBatchCount(20)).toBe(4);
  });

  it('prompts for a custom size and clamps it to the chunk count', async () => {
    promptMock
      .mockResolvedValueOnce({ size: -1 }) // chose "Custom..."
      .mockResolvedValueOnce({ custom: '999' }); // larger than chunk count
    expect(await promptBatchCount(8)).toBe(8);
  });

  it('does not list a split larger than the chunk count', async () => {
    let captured: Choice[] = [];
    promptMock.mockImplementationOnce((qs: Array<{ choices: Choice[] }>) => {
      captured = qs[0].choices;
      return Promise.resolve({ size: 4 });
    });
    await promptBatchCount(4);
    // Only all-at-once (4), distinct splits below 4, and custom (-1).
    const values = captured.map((c) => c.value);
    expect(values).toContain(4);
    expect(values).toContain(-1);
    expect(values.every((v) => v === -1 || (v >= 1 && v <= 4))).toBe(true);
  });
});

describe('promptAction commit label', () => {
  it('renders a batch-specific commit label when provided', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    input.write('\n'); // Enter on the default (commit) row

    const result = await promptAction({ input, output }, 'Commit this batch (2/4)');

    expect(result).toBe('commit');
    expect(Buffer.concat(chunks).toString('utf8')).toContain(
      'Commit this batch (2/4)'
    );
  });
});
