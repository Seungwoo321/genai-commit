# genai-commit

AI-powered commit message generator using Claude Code, Cursor CLI, or Codex CLI.

[![npm version](https://badge.fury.io/js/genai-commit.svg)](https://www.npmjs.com/package/genai-commit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/github/stars/Seungwoo321/genai-commit?style=social)](https://github.com/Seungwoo321/genai-commit)

> Read in other languages: [한국어](./README.ko.md)

## Features

- **AI-powered commit messages** - Generate meaningful commit messages using Claude Code, Cursor CLI, or Codex CLI
- **Conventional Commits** - Automatically follows the Conventional Commits specification
- **Multi-language support** - Generate titles and messages in English or Korean
- **Jira integration** - Assign Jira tickets to commits and auto-merge related changes
- **Interactive workflow** - Review, provide feedback, and refine before committing
- **Smart file grouping** - Intelligently splits changes into logical commits
- **Cluster-aware chunking** - For large changesets, builds an import graph and groups related files into chunks so each AI call sees a coherent slice
- **Cross-chunk semantic merge** - When chunks produce commits describing the same logical change, a merge pass unifies them with validation rollback (false splits over false merges)
- **Resumable batched commits** - Large changesets are frozen into a deterministic plan and committed in batches; stop anytime and continue later with `--resume`
- **Automatic staging** - Stages all changes (including untracked, renamed, and deleted files) before diff analysis
- **Works with empty repositories** - Generates commits even without prior commit history
- **Remote sync protection** - Aborts early if the branch is behind or diverged from remote
- **Gitignore-aware** - Respects `.gitignore` and works correctly from subdirectories

## Supported File Changes

| Change Type | Supported |
|-------------|-----------|
| Added files | Yes |
| Modified files | Yes |
| Deleted files | Yes |
| Renamed files | Yes |
| Untracked files | Yes (auto-staged) |
| Files in subdirectories | Yes |
| Empty repositories (no commits yet) | Yes |

## How It Works

```mermaid
flowchart TD
    A[Start: genai-commit] --> A1{Remote Status}
    A1 -->|behind/diverged| A2[Exit: pull required]
    A1 -->|ok| A3[Stage All Changes]
    A3 --> B[Collect Git Changes]
    B --> C{Changes Found?}
    C -->|No| D[Exit: No changes]
    C -->|Yes| E[Load Diffs and Source]
    E --> RP{Saved plan fresh?}
    RP -->|yes| PL[Reuse / resume frozen plan]
    RP -->|no| F[Build Import Graph]
    F --> G{Strategy}
    G -->|edges > 0| G1[Cluster: WCC + FFD bin pack]
    G -->|no edges| G2[Directory-based chunking]
    G1 --> BS[Choose batch count]
    G2 --> BS
    BS --> FR[Freeze plan to .git/genai-commit/plan.json]
    FR --> PL
    PL --> BL[Next pending batch]
    BL --> H[Per-chunk AI Generation]
    H --> I{Batch chunks &gt; 1?}
    I -->|yes| J[Cross-chunk Semantic Merge]
    I -->|no| K[Skip merge]
    J --> J1{Validate: coverage + title}
    J1 -->|ok| L[Display Proposed Commits]
    J1 -->|fail| K
    K --> L
    L --> M{User Action}
    M -->|y| N[Commit batch + mark chunks done]
    M -->|n| O[Cancel: --resume to continue]
    M -->|f| P[Get Feedback]
    M -->|t| Q[Assign Jira Tickets]
    P --> H
    Q --> R[Merge Same-Ticket Commits]
    R --> L
    N --> MB{More batches?}
    MB -->|yes| BL
    MB -->|no| S[Done]
```

### Architecture Principle

**Deterministic logic stays in code; only the truly non-deterministic parts go to the LLM.**

- **Deterministic (program-based)**
  - Import graph extraction (regex per language: ts/js/py/go/rust/java)
  - Weakly-Connected-Components clustering of related files
  - First-Fit Decreasing bin packing into chunk-size budgets
  - Coverage validation, title-length checks, file-path verbatim enforcement
- **Non-deterministic (LLM-based)**
  - Writing natural-language titles and messages from a grouped file set
  - Judging when files in different chunks describe the same logical change
  - Rejected outputs roll back to per-chunk results — no retry doubling AI cost

## Prerequisites

You need at least one of these AI CLI tools installed:

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's official CLI (command: `claude`)
- [Cursor Agent CLI](https://www.cursor.com/) - Cursor's agent CLI (command: `agent`)
- [OpenAI Codex CLI](https://github.com/openai/codex) - OpenAI's Codex CLI (command: `codex`)

## Providers

Each provider can be referenced by its canonical name or short alias:

| Canonical | Short Alias | Underlying CLI |
|-----------|-------------|----------------|
| `claude-code` | `claude` | `claude` |
| `cursor-cli` | `cursor` | `agent` |
| `codex-cli` | `codex` | `codex` |

## Installation

```bash
# Global installation
npm install -g genai-commit

# Or use directly with npx (no installation required)
npx genai-commit claude
```

## Usage

### Generate Commit Messages

```bash
# Canonical names
genai-commit claude-code
genai-commit cursor-cli
genai-commit codex-cli

# Short aliases (equivalent)
genai-commit claude
genai-commit cursor
genai-commit codex

# With specific model
genai-commit cursor --model claude-4.5-sonnet
genai-commit claude --model sonnet
genai-commit codex --model gpt-5.4

# Set language for both title and message
genai-commit claude --lang ko

# Set languages separately
genai-commit claude --title-lang en --message-lang ko
```

### Authentication

```bash
# Login
genai-commit login cursor
genai-commit login claude
genai-commit login codex

# Check status
genai-commit status claude
genai-commit status cursor
genai-commit status codex
```

### List Supported Models

```bash
genai-commit models cursor
genai-commit models claude
genai-commit models codex
```

### Interactive Options

After generating commit messages, you'll see an interactive menu:

| Option | Description |
|--------|-------------|
| `[y]` | Commit the proposed commits (the current batch, when batched) |
| `[n]` | Cancel (re-run with `--resume` to continue a partially committed plan) |
| `[f]` | Provide feedback to regenerate (single-chunk batches only) |
| `[t]` | Assign Jira tickets and regroup commits |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--lang <lang>` | Set both title and message language (en\|ko) | - |
| `--title-lang <lang>` | Language for commit title | `en` |
| `--message-lang <lang>` | Language for commit message | `ko` |
| `--model <model>` | Model to use | `haiku` (Claude) / `claude-4.5-sonnet` (Cursor) / `gpt-5.4` (Codex) |
| `--timeout <seconds>` | AI provider timeout in seconds | `120` |
| `--batches <n>` | Split a multi-chunk run into n batches | prompt (interactive) / all at once (non-interactive) |
| `--resume` | Continue a saved plan from the next pending batch | - |
| `--fresh` | Discard any saved plan and re-plan from the current changeset | - |

## Examples

### Basic Usage

```bash
# Navigate to your git repository
cd my-project

# Make some changes
echo "console.log('hello');" >> src/index.js

# Generate and create commits
genai-commit claude
```

### With Jira Integration

1. Run `genai-commit claude`
2. Review proposed commits
3. Press `t` to assign Jira tickets
4. Enter Jira URLs for each commit
5. Commits with the same Jira ticket are automatically merged
6. Press `y` to commit

### Providing Feedback

1. Run `genai-commit cursor`
2. Review proposed commits
3. Press `f` to provide feedback
4. Enter your feedback (e.g., "Split the auth changes into separate commits")
5. AI regenerates based on your feedback
6. Press `y` to commit

## Batched & Resumable Commits

A large changeset is split into deterministic chunks. To keep the split stable across runs, the full chunk partition is computed once and frozen to a plan at `.git/genai-commit/plan.json` (inside `.git`, so it is never staged). The same changeset always yields the same chunks.

You then commit the plan in batches, one batch at a time. After a batch's commits succeed, those chunks are marked done in the plan. If you stop partway — or cancel a batch — re-run with `--resume` to continue from the next pending batch.

```bash
# Split a large run into 5 batches (commit one batch, then the next)
genai-commit claude --batches 5

# Continue a saved plan from where you left off
genai-commit claude --resume

# Discard the saved plan and re-plan from the current changeset
genai-commit claude --fresh
```

- Run interactively without `--batches` and you're prompted to choose how many batches to use.
- Run non-interactively (no TTY) and the changeset is committed all at once.
- A saved plan is reused automatically while it still matches the working tree. If the changeset drifts so the plan no longer matches, it is re-planned — or, with `--resume`, the mismatch is reported and `--fresh` is requested.
- Feedback (`[f]`) is available only for single-chunk batches, since a multi-chunk batch would regenerate just part of its commits.

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
| `maxInputSize` | 30000 | Per-chunk input budget in characters; drives clustering and bin-packing |
| `maxDiffSize` | 15000 | Maximum diff size per file in bytes (larger diffs are summarized) |
| `timeout` | 120000 | AI request timeout in ms |
| `maxRetries` | 2 | Per-chunk AI retry count on failure |

## Requirements

- Node.js >= 18.0.0
- Git repository
- Claude Code CLI, Cursor CLI, or Codex CLI installed and authenticated

## License

MIT
