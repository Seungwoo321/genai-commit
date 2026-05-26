#!/usr/bin/env node
/**
 * genai-commit CLI - AI-powered commit message generator
 */

import { Command } from 'commander';
import { generateCommand } from './commands/generate.js';
import { loginCommand } from './commands/login.js';
import { statusCommand } from './commands/status.js';
import { modelsCommand } from './commands/models.js';

const program = new Command();

program
  .name('genai-commit')
  .description('AI-powered commit message generator using Claude Code, Cursor CLI, or Codex CLI')
  .version('1.0.0');

// Main generation command: genai-commit <provider>
program
  .argument('<provider>', 'AI provider: claude-code|claude, cursor-cli|cursor, codex-cli|codex')
  .option('--lang <lang>', 'Set both title and message language (en|ko)')
  .option('--title-lang <lang>', 'Language for commit title (en|ko)', 'en')
  .option('--message-lang <lang>', 'Language for commit message (en|ko)', 'ko')
  .option('--model <model>', 'Model to use (varies by provider; see: genai-commit models <provider>)')
  .option('--timeout <seconds>', 'AI provider timeout in seconds (default: 120)')
  .option('--batches <n>', 'Split a multi-chunk run into n batches (default: prompt, or all at once when non-interactive)')
  .option('--resume', 'Continue a saved plan from the next pending batch')
  .option('--fresh', 'Discard any saved plan and re-plan from the current changeset')
  .action(generateCommand);

// Login command: genai-commit login <provider>
program
  .command('login <provider>')
  .description('Authenticate with the provider')
  .action(loginCommand);

// Status command: genai-commit status <provider>
program
  .command('status <provider>')
  .description('Check authentication status')
  .action(statusCommand);

// Models command: genai-commit models <provider>
program
  .command('models <provider>')
  .description('List supported models for a provider')
  .action(modelsCommand);

// Help examples
program.addHelpText(
  'after',
  `
Providers (canonical | short alias):
  claude-code | claude     Anthropic Claude Code CLI
  cursor-cli  | cursor     Cursor Agent CLI
  codex-cli   | codex      OpenAI Codex CLI

Examples:
  $ genai-commit claude                   # Generate with Claude Code (short alias)
  $ genai-commit cursor                   # Generate with Cursor CLI
  $ genai-commit codex                    # Generate with Codex CLI
  $ genai-commit claude-code --lang ko    # Canonical name, Korean title and message
  $ genai-commit cursor --model gpt-4o    # Override model

  $ genai-commit claude --batches 5       # Split a large run into 5 batches
  $ genai-commit claude --resume          # Continue a saved plan's next batch
  $ genai-commit claude --fresh           # Discard the saved plan and re-plan

  $ genai-commit login codex              # Login to Codex CLI
  $ genai-commit status claude            # Check Claude Code status
  $ genai-commit models cursor            # List supported models for Cursor

Batched runs:
  A large changeset is split into deterministic chunks and frozen to a plan so
  the same changeset always yields the same split. Commit it in batches; if you
  stop partway, re-run with --resume to continue where you left off.

Interactive options:
  [y] Commit the proposed commits (the current batch, when batched)
  [n] Cancel
  [f] Provide feedback to regenerate (single-chunk batches only)
  [t] Assign Jira tickets and regroup commits
`
);

program.parse();
