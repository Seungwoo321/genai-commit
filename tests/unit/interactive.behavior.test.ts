/**
 * Behavior tests for promptAction.
 *
 * Drives the action prompt with a PassThrough stdin so we can verify the
 * outcome of actual keystrokes (Enter, arrow Down, hotkeys) instead of just
 * checking config. The prompt uses Node's readline keypress decoder, so the
 * standard ANSI sequences (`\x1B[B` for Down, `\n` for Enter) and printable
 * characters (`y`, `n`, `f`, `t`) trigger the same code paths a real TTY
 * would.
 *
 * Hotkeys move the cursor; Enter is required to submit.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptAction } from '../../src/ui/interactive.js';

const KEY_DOWN = '\x1B[B';
const KEY_ENTER = '\n';

async function runWithKeys(keys: string): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  input.write(keys);
  return promptAction({ input, output });
}

describe('promptAction (driven by real keystrokes)', () => {
  it('returns commit when Enter is pressed on the default highlighted choice', async () => {
    expect(await runWithKeys(KEY_ENTER)).toBe('commit');
  });

  it('returns cancel after one Down + Enter', async () => {
    expect(await runWithKeys(KEY_DOWN + KEY_ENTER)).toBe('cancel');
  });

  it('returns feedback after two Down + Enter', async () => {
    expect(await runWithKeys(KEY_DOWN + KEY_DOWN + KEY_ENTER)).toBe('feedback');
  });

  it('returns jira after three Down + Enter', async () => {
    expect(await runWithKeys(KEY_DOWN + KEY_DOWN + KEY_DOWN + KEY_ENTER)).toBe('jira');
  });

  it('y hotkey + Enter selects commit', async () => {
    expect(await runWithKeys('y' + KEY_ENTER)).toBe('commit');
  });

  it('n hotkey + Enter selects cancel', async () => {
    expect(await runWithKeys('n' + KEY_ENTER)).toBe('cancel');
  });

  it('f hotkey + Enter selects feedback', async () => {
    expect(await runWithKeys('f' + KEY_ENTER)).toBe('feedback');
  });

  it('t hotkey + Enter selects jira', async () => {
    expect(await runWithKeys('t' + KEY_ENTER)).toBe('jira');
  });
});
