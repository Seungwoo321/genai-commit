import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptAction } from '../../src/ui/interactive.js';

const KEY_DOWN = '\x1B[B';
const KEY_UP = '\x1B[A';
const KEY_ENTER = '\n';

async function run(keys: string): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  input.write(keys);
  return promptAction({ input, output });
}

describe('promptAction', () => {
  describe('hotkeys move the cursor; Enter is required to submit', () => {
    it.each<[string, string]>([
      ['y', 'commit'],
      ['n', 'cancel'],
      ['f', 'feedback'],
      ['t', 'jira'],
    ])('lowercase %s + Enter selects %s', async (key, expected) => {
      expect(await run(key + KEY_ENTER)).toBe(expected);
    });

    it.each<[string, string]>([
      ['Y', 'commit'],
      ['N', 'cancel'],
      ['F', 'feedback'],
      ['T', 'jira'],
    ])('uppercase %s + Enter selects %s', async (key, expected) => {
      expect(await run(key + KEY_ENTER)).toBe(expected);
    });

    it('hotkey followed by Down moves cursor relative to the hotkey target', async () => {
      // f puts cursor on feedback (index 2); Down moves to jira (index 3).
      expect(await run('f' + KEY_DOWN + KEY_ENTER)).toBe('jira');
    });

    it('a hotkey can override an earlier hotkey before Enter', async () => {
      // n moves to cancel; t then moves to jira; Enter submits jira.
      expect(await run('n' + 't' + KEY_ENTER)).toBe('jira');
    });

    it('hotkey alone does NOT submit (Enter still required)', async () => {
      // After 'y' the cursor is on commit (already the initial position),
      // then Down moves to cancel; Enter submits cancel. If the hotkey had
      // submitted on its own this would have returned commit instead.
      expect(await run('y' + KEY_DOWN + KEY_ENTER)).toBe('cancel');
    });
  });

  describe('arrow navigation + Enter', () => {
    it('Enter on the initial cursor returns commit', async () => {
      expect(await run(KEY_ENTER)).toBe('commit');
    });

    it.each<[string, string]>([
      [KEY_DOWN + KEY_ENTER, 'cancel'],
      [KEY_DOWN + KEY_DOWN + KEY_ENTER, 'feedback'],
      [KEY_DOWN + KEY_DOWN + KEY_DOWN + KEY_ENTER, 'jira'],
    ])('Down arrows %s yield %s', async (keys, expected) => {
      expect(await run(keys)).toBe(expected);
    });

    it('Up arrow wraps from commit to jira', async () => {
      expect(await run(KEY_UP + KEY_ENTER)).toBe('jira');
    });

    it('Down arrow wraps from jira back to commit', async () => {
      expect(
        await run(KEY_DOWN + KEY_DOWN + KEY_DOWN + KEY_DOWN + KEY_ENTER)
      ).toBe('commit');
    });
  });
});
