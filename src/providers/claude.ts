/**
 * Claude Code CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand, execSimple } from '../utils/exec.js';
import { getPromptTemplate, getJsonSchema } from '../prompts/templates.js';
import { parseJsonResponse } from '../parser/json.js';
import { CLAUDE_DEFAULT_MODEL } from '../config/defaults.js';

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code' as const;
  private sessionId?: string;
  private timeout: number;
  private model: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.model = options?.model ?? CLAUDE_DEFAULT_MODEL;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('claude', promptType);
    const schema = getJsonSchema();

    const args = [
      '-p',
      '--model', this.model,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
      '--append-system-prompt', prompt,
    ];

    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    const result = await execCommand('claude', args, {
      input,
      timeout: this.timeout,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Claude CLI failed: ${result.stderr}`);
    }

    try {
      const parsed = JSON.parse(result.stdout);
      this.sessionId = parsed.session_id;

      return {
        raw: JSON.stringify(parsed.structured_output),
        sessionId: this.sessionId,
      };
    } catch (error) {
      throw new Error(`Failed to parse Claude response: ${result.stdout}`);
    }
  }

  parseResponse(response: ProviderResponse): CommitResult {
    return parseJsonResponse(response.raw);
  }

  async login(): Promise<void> {
    console.log('Setting up Claude Code authentication...');
    await execCommand('claude', ['setup-token'], { timeout: 60000 });
  }

  async status(): Promise<ProviderStatus> {
    try {
      const version = await execSimple('claude', ['--version'], { timeout: 10000 });
      return {
        available: true,
        version: version.trim(),
        details: 'Claude Code CLI is available',
      };
    } catch {
      return {
        available: false,
        details: 'Claude Code CLI not found. Install it first.',
      };
    }
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  clearSession(): void {
    this.sessionId = undefined;
  }
}
