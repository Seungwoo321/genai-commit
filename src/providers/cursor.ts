/**
 * Cursor CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand } from '../utils/exec.js';
import { getPromptTemplate } from '../prompts/templates.js';
import { parseDelimiterResponse } from '../parser/delimiter.js';
import { CURSOR_DEFAULT_MODEL } from '../config/defaults.js';

export class CursorCLIProvider implements AIProvider {
  readonly name = 'cursor-cli' as const;
  private timeout: number;
  private model: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.model = options?.model ?? CURSOR_DEFAULT_MODEL;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('cursor', promptType);
    const fullInput = `${prompt}\n\n---\n\n${input}`;

    const result = await execCommand(
      'cursor',
      ['agent', '-p', '--model', this.model, '--output-format', 'text'],
      {
        input: fullInput,
        timeout: this.timeout,
      }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Cursor CLI failed: ${result.stderr}`);
    }

    return { raw: result.stdout };
  }

  parseResponse(response: ProviderResponse): CommitResult {
    return parseDelimiterResponse(response.raw);
  }

  async login(): Promise<void> {
    console.log('Logging in to Cursor...');
    await execCommand('cursor', ['agent', 'login'], { timeout: 60000 });
  }

  async status(): Promise<ProviderStatus> {
    try {
      const result = await execCommand('cursor', ['agent', 'status'], { timeout: 10000 });
      return {
        available: true,
        details: result.stdout.trim() || 'Cursor CLI is available',
      };
    } catch {
      return {
        available: false,
        details: 'Cursor CLI not available. Install it first.',
      };
    }
  }

  getSessionId(): string | undefined {
    return undefined; // Cursor doesn't support session resume
  }

  clearSession(): void {
    // No-op for Cursor
  }
}
