import { describe, it, expect, vi, beforeEach } from 'vitest';
import inquirer from 'inquirer';
import { promptAction, type UserAction } from '../../src/ui/interactive.js';

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

const mockedPrompt = vi.mocked(inquirer.prompt);

describe('promptAction', () => {
  beforeEach(() => {
    mockedPrompt.mockReset();
  });

  it('uses the expand prompt type so hotkeys are bound, not decorative', async () => {
    mockedPrompt.mockResolvedValueOnce({ action: 'commit' });

    await promptAction();

    expect(mockedPrompt).toHaveBeenCalledTimes(1);
    const questions = mockedPrompt.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe('expand');
  });

  it('binds y/n/f/t hotkeys to commit/cancel/feedback/jira', async () => {
    mockedPrompt.mockResolvedValueOnce({ action: 'commit' });

    await promptAction();

    const questions = mockedPrompt.mock.calls[0][0] as Array<{
      choices: Array<{ key: string; value: UserAction }>;
    }>;
    const choices = questions[0].choices;

    expect(choices).toEqual([
      expect.objectContaining({ key: 'y', value: 'commit' }),
      expect.objectContaining({ key: 'n', value: 'cancel' }),
      expect.objectContaining({ key: 'f', value: 'feedback' }),
      expect.objectContaining({ key: 't', value: 'jira' }),
    ]);
  });

  it.each<[UserAction]>([
    ['commit'],
    ['cancel'],
    ['feedback'],
    ['jira'],
  ])('returns the %s action selected by the user', async (action) => {
    mockedPrompt.mockResolvedValueOnce({ action });

    const result = await promptAction();

    expect(result).toBe(action);
  });
});
