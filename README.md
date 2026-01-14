# genco-cli

AI-powered commit message generator using Claude Code or Cursor CLI.

[![npm version](https://badge.fury.io/js/genco-cli.svg)](https://www.npmjs.com/package/genco-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/stars/Seungwoo321/genco-cli?style=social)](https://github.com/Seungwoo321/genco-cli)

## Features

- **AI-powered commit messages** - Generate meaningful commit messages using Claude Code or Cursor CLI
- **Conventional Commits** - Automatically follows the Conventional Commits specification
- **Multi-language support** - Generate titles and messages in English or Korean
- **Jira integration** - Assign Jira tickets to commits and auto-merge related changes
- **Interactive workflow** - Review, provide feedback, and refine before committing
- **Smart file grouping** - Intelligently splits changes into logical commits

## Prerequisites

You need at least one of these AI CLI tools installed:

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's official CLI
- [Cursor CLI](https://www.cursor.com/) - Cursor's agent CLI

## Installation

```bash
# Global installation
npm install -g genco-cli

# Or use directly with npx (no installation required)
npx genco-cli claude-code
```

## Usage

### Generate Commit Messages

```bash
# Using Claude Code
genco claude-code

# Using Cursor CLI
genco cursor-cli

# With specific model (Cursor only)
genco cursor-cli --model sonnet-4.5

# Set language for both title and message
genco claude-code --lang ko

# Set languages separately
genco claude-code --title-lang en --message-lang ko
```

### Authentication

```bash
# Login to Cursor
genco login cursor-cli

# Setup Claude token
genco login claude-code

# Check status
genco status claude-code
genco status cursor-cli
```

### Interactive Options

After generating commit messages, you'll see an interactive menu:

| Option | Description |
|--------|-------------|
| `[y]` | Commit all proposed commits |
| `[n]` | Cancel |
| `[f]` | Provide feedback to regenerate |
| `[t]` | Assign Jira tickets and regroup commits |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--lang <lang>` | Set both title and message language (en\|ko) | - |
| `--title-lang <lang>` | Language for commit title | `en` |
| `--message-lang <lang>` | Language for commit message | `ko` |
| `--model <model>` | Model to use (Cursor CLI only) | `gemini-3-flash` |

## Examples

### Basic Usage

```bash
# Navigate to your git repository
cd my-project

# Make some changes
echo "console.log('hello');" >> src/index.js

# Generate and create commits
genco claude-code
```

### With Jira Integration

1. Run `genco claude-code`
2. Review proposed commits
3. Press `t` to assign Jira tickets
4. Enter Jira URLs for each commit
5. Commits with the same Jira ticket are automatically merged
6. Press `y` to commit

### Providing Feedback

1. Run `genco cursor-cli`
2. Review proposed commits
3. Press `f` to provide feedback
4. Enter your feedback (e.g., "Split the auth changes into separate commits")
5. AI regenerates based on your feedback
6. Press `y` to commit

## Programmatic Usage

```typescript
import {
  createProvider,
  isGitRepository,
  getCurrentBranch,
  getGitStatus,
  generateFullTreeSummary,
} from 'genco-cli';

// Create a provider
const provider = createProvider('claude-code', { timeout: 120000 });

// Check provider status
const status = await provider.status();
console.log(status.available ? 'Ready' : 'Not available');

// Generate commits programmatically
const branch = await getCurrentBranch();
const { changes } = await getGitStatus();
const treeSummary = generateFullTreeSummary(branch, changes);

const response = await provider.generate(treeSummary, 'commit');
const result = provider.parseResponse(response);

console.log(result.commits);
```

## Supported Commit Types

Following the Conventional Commits specification:

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting (no code change) |
| `refactor` | Code restructuring |
| `test` | Adding tests |
| `chore` | Maintenance |
| `perf` | Performance improvement |
| `ci` | CI/CD changes |
| `build` | Build system changes |

## Configuration

The tool uses sensible defaults but can be configured:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxInputSize` | 30000 | Maximum input size in bytes |
| `maxDiffSize` | 15000 | Maximum diff size in bytes |
| `timeout` | 120000 | AI request timeout in ms |
| `treeDepth` | 3 | Directory depth for tree compression |

## Requirements

- Node.js >= 18.0.0
- Git repository
- Claude Code CLI or Cursor CLI installed and authenticated

## License

MIT
