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

  it('uses the list prompt type for arrow-key selection', async () => {
    mockedPrompt.mockResolvedValueOnce({ action: 'commit' });

    await promptAction();

    expect(mockedPrompt).toHaveBeenCalledTimes(1);
    const questions = mockedPrompt.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe('list');
  });

  it('defaults the cursor to commit so Enter triggers Commit all', async () => {
    mockedPrompt.mockResolvedValueOnce({ action: 'commit' });

    await promptAction();

    const questions = mockedPrompt.mock.calls[0][0] as Array<{
      default: UserAction;
      choices: Array<{ value: UserAction }>;
    }>;
    expect(questions[0].default).toBe('commit');
    expect(questions[0].choices[0].value).toBe('commit');
  });

  it('exposes commit/cancel/feedback/jira choices in order', async () => {
    mockedPrompt.mockResolvedValueOnce({ action: 'commit' });

    await promptAction();

    const questions = mockedPrompt.mock.calls[0][0] as Array<{
      choices: Array<{ value: UserAction }>;
    }>;
    const choices = questions[0].choices;

    expect(choices).toEqual([
      expect.objectContaining({ value: 'commit' }),
      expect.objectContaining({ value: 'cancel' }),
      expect.objectContaining({ value: 'feedback' }),
      expect.objectContaining({ value: 'jira' }),
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
