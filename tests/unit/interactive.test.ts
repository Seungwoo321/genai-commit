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

interface PromptRun {
  result: string;
  output: string;
}

async function runCapturing(keys: string): Promise<PromptRun> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  input.write(keys);
  const result = await promptAction({ input, output });
  return { result, output: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Tiny virtual terminal that interprets the subset of ANSI sequences this
 * prompt emits: `\r`, `\n`, `\x1B[NA` (cursor up), `\x1B[NK` (erase line),
 * and ignores `\x1B[Nm` (SGR color). Returns the lines visible on screen
 * after replaying the byte stream — what the user would actually see.
 */
function virtualTerminal(output: string): string[] {
  const screen: string[] = [''];
  let row = 0;
  let col = 0;
  const ensureRow = (): void => {
    while (screen.length <= row) screen.push('');
  };
  for (let i = 0; i < output.length; ) {
    const c = output[i];
    if (c === '\r') { col = 0; i++; continue; }
    if (c === '\n') { row++; col = 0; ensureRow(); i++; continue; }
    if (c === '\x1B' && output[i + 1] === '[') {
      let j = i + 2;
      while (j < output.length && !/[A-Za-z]/.test(output[j])) j++;
      const params = output.slice(i + 2, j);
      const cmd = output[j];
      i = j + 1;
      if (cmd === 'A') {
        row = Math.max(0, row - parseInt(params || '1', 10));
      } else if (cmd === 'B') {
        row += parseInt(params || '1', 10);
        ensureRow();
      } else if (cmd === 'K') {
        ensureRow();
        const mode = parseInt(params || '0', 10);
        if (mode === 0) screen[row] = screen[row].slice(0, col);
        else if (mode === 1) screen[row] = ' '.repeat(col) + screen[row].slice(col);
        else screen[row] = '';
      }
      continue;
    }
    ensureRow();
    const line = screen[row];
    const padded = line.length < col ? line + ' '.repeat(col - line.length) : line;
    screen[row] = padded.slice(0, col) + c + padded.slice(col + 1);
    col++;
    i++;
  }
  return screen;
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

  describe('rendering does not duplicate the question on cursor moves', () => {
    // Regression: a trailing newline in render() left the cursor on a blank
    // row below the prompt, so clearRendered's loop wasted its first clear
    // on that blank and never reached the question line. The result was a
    // stack of "? What would you like to do?" lines, one per cursor move.
    const QUESTION = 'What would you like to do?';

    it('keeps exactly one question line on the visible screen after many cursor moves', async () => {
      const { output } = await runCapturing(
        KEY_DOWN + KEY_DOWN + KEY_UP + 'f' + 'n' + 't' + 'y' + KEY_ENTER
      );
      const screen = virtualTerminal(output);
      const occurrences = screen.filter((l) => l.includes(QUESTION)).length;
      expect(occurrences).toBe(1);
    });

    it('renders exactly one cursor caret on the visible screen', async () => {
      const { output } = await runCapturing(KEY_DOWN + KEY_DOWN + KEY_ENTER);
      const screen = virtualTerminal(output);
      const caretLines = screen.filter((l) => l.includes('❯'));
      expect(caretLines).toHaveLength(1);
    });
  });
});
