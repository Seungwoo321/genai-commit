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

  describe('process exit hygiene', () => {
    // Regression: the prompt called `input.resume()` at start to put stdin in
    // flowing mode, but never paired it with `input.pause()` on resolve. With
    // a refed I/O handle still in flowing mode, libuv kept the event loop
    // alive after the action completed, so the CLI hung after a successful
    // commit until the user sent SIGINT.
    it('pauses the input stream after resolving so the event loop can exit', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      output.resume();
      input.write(KEY_ENTER);
      await promptAction({ input, output });
      expect(input.isPaused()).toBe(true);
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

  // Regression: multi-chunk runs disabled feedback in the handler but still
  // listed [f] in the menu, so selecting it printed a warning and did nothing
  // ("골라도 동작 안 함"). A disabled action must be absent from the menu, not
  // shown-and-refused.
  describe('feedbackEnabled gating', () => {
    async function runDisabled(keys: string): Promise<PromptRun> {
      const input = new PassThrough();
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (c: Buffer) => chunks.push(c));
      input.write(keys);
      const result = await promptAction({ input, output }, 'Commit all', false);
      return { result, output: Buffer.concat(chunks).toString('utf8') };
    }

    it('omits the Provide feedback row when feedback is disabled', async () => {
      const { output } = await runDisabled(KEY_ENTER);
      expect(output).not.toContain('Provide feedback');
    });

    it('treats the f hotkey as a no-op when feedback is disabled', async () => {
      // No [f] choice exists, so 'f' matches nothing and the cursor stays on
      // commit; Enter then submits commit instead of feedback.
      expect((await runDisabled('f' + KEY_ENTER)).result).toBe('commit');
    });

    it('collapses the menu so two Downs land on jira (commit→cancel→jira)', async () => {
      expect((await runDisabled(KEY_DOWN + KEY_DOWN + KEY_ENTER)).result).toBe('jira');
    });

    it('still lists feedback when enabled (default)', async () => {
      const { output } = await runCapturing(KEY_ENTER);
      expect(output).toContain('Provide feedback');
    });
  });
});
