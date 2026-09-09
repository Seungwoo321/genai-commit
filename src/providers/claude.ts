/**
 * Claude Code CLI provider implementation
 */

import type { AIProvider, ProviderResponse, ProviderStatus, ProviderOptions, PromptType } from './types.js';
import type { CommitResult } from '../types/commit.js';
import { execCommand, execSimple } from '../utils/exec.js';
import { getPromptTemplate, getJsonSchema } from '../prompts/templates.js';
import { parseJsonResponse } from '../parser/json.js';
import { withModelFallback, reportModel } from './discovery.js';

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code' as const;
  private sessionId?: string;
  private timeout: number;
  /** Undefined means "resolve from the provider's own tier aliases at run time". */
  private explicitModel?: string;

  constructor(options?: ProviderOptions) {
    this.timeout = options?.timeout ?? 120000;
    this.explicitModel = options?.model;
  }

  async generate(input: string, promptType: PromptType): Promise<ProviderResponse> {
    const prompt = getPromptTemplate('claude', promptType);
    const schema = getJsonSchema();

    const schemaText = JSON.stringify(schema);

    return withModelFallback({
      provider: this.name,
      explicitModel: this.explicitModel,
      inputChars: input.length + prompt.length + schemaText.length,
      onSelect: reportModel(this.name),
      attempt: (model) => this.runOnce(input, prompt, schemaText, model),
    });
  }

  private async runOnce(
    input: string,
    prompt: string,
    schemaText: string,
    model: string
  ): Promise<ProviderResponse> {
    const args = [
      '-p',
      '--model', model,
      '--output-format', 'json',
      '--json-schema', schemaText,
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
      // claude -p (especially with --output-format json) reports errors such as
      // usage-limit or context overflow on stdout, not stderr.
      const detail = [result.stderr, result.stdout]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join('\n');
      throw new Error(`Claude CLI failed (exit ${result.exitCode}): ${detail || '(no output)'}`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Failed to parse Claude response: ${result.stdout}`);
    }
    this.sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;

    // Error subtypes (usage limit, execution error, ...) exit 0 but carry no
    // structured_output; stringifying undefined would leak `undefined` into the parser.
    if (parsed.structured_output === undefined) {
      const reason =
        typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed);
      const subtype = typeof parsed.subtype === 'string' ? ` (${parsed.subtype})` : '';
      throw new Error(
        `Claude returned no structured output${subtype}: ${reason.substring(0, 500)}`
      );
    }

    return {
      raw: JSON.stringify(parsed.structured_output),
      sessionId: this.sessionId,
    };
  }

  parseResponse(response: ProviderResponse): CommitResult {
    return parseJsonResponse(response.raw);
  }

  async login(): Promise<void> {
    console.log('Setting up Claude Code authentication token...');
    console.log('This requires a Claude subscription.');
    console.log('');
    await execCommand('claude', ['setup-token'], { timeout: 120000, interactive: true });
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
