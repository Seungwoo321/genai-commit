/**
 * Behavior tests for promptAction.
 *
 * Drives the real inquirer with a PassThrough stdin so we can verify the
 * outcome of actual keystrokes (Enter, arrow Down) instead of just checking
 * the question config.
 *
 * Inquirer's readline is created with `terminal: true`, so it parses ANSI
 * escape sequences from the input stream — `\x1B[B` is Down, `\n` is Enter.
 * Writing the full keystroke sequence ahead of time works because the data
 * is buffered until readline subscribes.
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import inquirer from 'inquirer';
import { promptAction } from '../../src/ui/interactive.js';

const KEY_DOWN = '\x1B[B';
const KEY_ENTER = '\n';

interface DrivenPrompt {
  input: PassThrough;
  prompt: typeof inquirer.prompt;
}

function makeDrivenPrompt(): DrivenPrompt {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const prompt = inquirer.createPromptModule({ input, output, skipTTYChecks: true });
  return { input, prompt };
}

async function runWithKeys(keys: string): Promise<string> {
  const { input, prompt } = makeDrivenPrompt();
  input.write(keys);
  return promptAction(prompt);
}

describe('promptAction (real inquirer)', () => {
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
});
