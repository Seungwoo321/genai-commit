/**
 * Codex CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand, execSimple } from '../utils/exec.js';
import { getPromptTemplate } from '../prompts/templates.js';
import { parseDelimiterResponse } from '../parser/delimiter.js';
import {
  withModelFallback,
  reportModel,
  discoverModels,
  resolveReasoningEffort,
} from './discovery.js';

export class CodexCLIProvider implements AIProvider {
  readonly name = 'codex-cli' as const;
  private timeout: number;
  /** Undefined means "resolve from the provider's own catalog at run time". */
  private explicitModel?: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.explicitModel = options?.model;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('codex', promptType);
    const fullInput = `${prompt}\n\n---\n\n${input}`;

    return withModelFallback({
      provider: this.name,
      explicitModel: this.explicitModel,
      inputChars: fullInput.length,
      onSelect: reportModel(this.name),
      attempt: async (model) => {
        const args = ['exec', '--model', model, '--skip-git-repo-check', '--color', 'never'];

        // Pin the effort instead of inheriting the user's global setting: writing a
        // commit message needs none of it, and a machine configured with a level the
        // small models reject (`max` is large-model only) would otherwise be unable
        // to use them at all.
        const effort = resolveReasoningEffort(await discoverModels(this.name), model);
        if (effort) args.push('-c', `model_reasoning_effort=${effort}`);

        args.push('-');

        const result = await execCommand('codex', args, {
          input: fullInput,
          timeout: this.timeout,
        });

        if (result.exitCode !== 0) {
          throw new Error(`Codex CLI failed: ${result.stderr}`);
        }

        return { raw: result.stdout };
      },
    });
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
