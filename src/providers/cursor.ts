/**
 * Cursor CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand } from '../utils/exec.js';
import { getPromptTemplate } from '../prompts/templates.js';
import { parseDelimiterResponse } from '../parser/delimiter.js';
import { withModelFallback, reportModel } from './discovery.js';

export class CursorCLIProvider implements AIProvider {
  readonly name = 'cursor-cli' as const;
  private timeout: number;
  /** Undefined means "resolve from the provider's own catalog at run time". */
  private explicitModel?: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.explicitModel = options?.model;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('cursor', promptType);
    const fullInput = `${prompt}\n\n---\n\n${input}`;

    return withModelFallback({
      provider: this.name,
      explicitModel: this.explicitModel,
      inputChars: fullInput.length,
      onSelect: reportModel(this.name),
      attempt: async (model) => {
        const result = await execCommand(
          'agent',
          ['-p', '--trust', '--model', model, '--output-format', 'text'],
          { input: fullInput, timeout: this.timeout }
        );

        if (result.exitCode !== 0) {
          throw new Error(`Cursor CLI failed: ${result.stderr}`);
        }

        return { raw: result.stdout };
      },
    });
  }

  parseResponse(response: ProviderResponse): CommitResult {
    return parseDelimiterResponse(response.raw);
  }

  async login(): Promise<void> {
    console.log('Logging in to Cursor Agent...');
    await execCommand('agent', ['login'], { timeout: 120000, interactive: true });
  }

  async status(): Promise<ProviderStatus> {
    try {
      const result = await execCommand('agent', ['--version'], { timeout: 10000 });
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
