#!/usr/bin/env node
/**
 * genai-commit CLI - AI-powered commit message generator
 */

import { Command } from 'commander';
import { generateCommand } from './commands/generate.js';
import { loginCommand } from './commands/login.js';
import { statusCommand } from './commands/status.js';

const program = new Command();

program
  .name('genai-commit')
  .description('AI-powered commit message generator using Claude Code or Cursor CLI')
  .version('1.0.0');

// Main generation command: genai-commit <provider>
program
  .argument('<provider>', 'AI provider (claude-code or cursor-cli)')
  .option('--lang <lang>', 'Set both title and message language (en|ko)')
  .option('--title-lang <lang>', 'Language for commit title (en|ko)', 'en')
  .option('--message-lang <lang>', 'Language for commit message (en|ko)', 'ko')
  .option('--model <model>', 'Model to use (cursor-cli: gemini-3-flash, sonnet-4.5, etc.)')
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

// Help examples
program.addHelpText(
  'after',
  `
Examples:
  $ genai-commit claude-code              # Generate with Claude Code
  $ genai-commit cursor-cli               # Generate with Cursor CLI
  $ genai-commit cursor-cli --model sonnet-4.5
  $ genai-commit claude-code --lang ko    # Korean title and message

  $ genai-commit login cursor-cli         # Login to Cursor
  $ genai-commit login claude-code        # Setup Claude token
  $ genai-commit status claude-code       # Check Claude status

Interactive options:
  [y] Commit all proposed commits
  [n] Cancel
  [f] Provide feedback to regenerate
  [t] Assign Jira tickets and regroup commits
`
);

program.parse();
