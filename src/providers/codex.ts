/**
 * Codex CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand, execSimple } from '../utils/exec.js';
import { getPromptTemplate } from '../prompts/templates.js';
import { parseDelimiterResponse } from '../parser/delimiter.js';
import { CODEX_DEFAULT_MODEL } from '../config/defaults.js';

export class CodexCLIProvider implements AIProvider {
  readonly name = 'codex-cli' as const;
  private timeout: number;
  private model: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.model = options?.model ?? CODEX_DEFAULT_MODEL;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('codex', promptType);
    const fullInput = `${prompt}\n\n---\n\n${input}`;

    const result = await execCommand(
      'codex',
      [
        'exec',
        '--model', this.model,
        '--skip-git-repo-check',
        '--color', 'never',
        '-',
      ],
      {
        input: fullInput,
        timeout: this.timeout,
      }
    );

    if (result.exitCode !== 0) {
      throw new Error(`Codex CLI failed: ${result.stderr}`);
    }

    return { raw: result.stdout };
  }

  parseResponse(response: ProviderResponse): CommitResult {
    return parseDelimiterResponse(response.raw);
  }

  async login(): Promise<void> {
    console.log('Logging in to Codex CLI...');
    await execCommand('codex', ['login'], { timeout: 120000, interactive: true });
  }

  async status(): Promise<ProviderStatus> {
    try {
      const version = await execSimple('codex', ['--version'], { timeout: 10000 });
      return {
        available: true,
        version: version.trim(),
        details: 'Codex CLI is available',
      };
    } catch {
      return {
        available: false,
        details: 'Codex CLI not available. Install it first.',
      };
    }
  }

  getSessionId(): string | undefined {
    return undefined;
  }

  clearSession(): void {
    // No-op for Codex
  }
}
