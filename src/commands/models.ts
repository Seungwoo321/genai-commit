/**
 * Models command - list supported models per provider
 */

import { PROVIDER_CHOICES } from '../providers/types.js';
import { normalizeProviderType } from '../providers/index.js';
import {
  CURSOR_MODELS,
  CLAUDE_MODELS,
  CODEX_MODELS,
  CURSOR_DEFAULT_MODEL,
  CLAUDE_DEFAULT_MODEL,
  CODEX_DEFAULT_MODEL,
} from '../config/defaults.js';
import { logger } from '../utils/logger.js';

/**
 * Models command handler
 */
export function modelsCommand(provider: string): void {
  const providerType = normalizeProviderType(provider);
  if (!providerType) {
    logger.error(`Unknown provider: ${provider}`);
    console.log(`Available providers: ${PROVIDER_CHOICES}`);
    process.exit(1);
  }

  let models;
  let defaultModel;
  let helpHint;

  switch (providerType) {
    case 'cursor-cli':
      models = CURSOR_MODELS;
      defaultModel = CURSOR_DEFAULT_MODEL;
      helpHint = 'agent --help';
      break;
    case 'claude-code':
      models = CLAUDE_MODELS;
      defaultModel = CLAUDE_DEFAULT_MODEL;
      helpHint = 'claude --help';
      break;
    case 'codex-cli':
      models = CODEX_MODELS;
      defaultModel = CODEX_DEFAULT_MODEL;
      helpHint = 'codex --help';
      break;
  }

  console.log(`\nSupported models for ${providerType}:\n`);

  for (const model of models) {
    const isDefault = model.name === defaultModel;
    const marker = isDefault ? ' *' : '  ';
    console.log(`${marker} ${model.name.padEnd(20)} ${model.description}`);
  }

  console.log('\n* = default model');
  console.log(`\nUsage: genai-commit ${providerType} --model <model-name>`);
  console.log(`\nFor the latest supported models, run: ${helpHint}`);
  console.log('');
}
