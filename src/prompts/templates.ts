/**
 * Embedded prompt templates for AI providers
 */

export type ProviderPromptType = 'claude' | 'cursor';
export type PromptCategory = 'commit' | 'regroup';

// Claude Code prompts (JSON output)
const CLAUDE_COMMIT_PROMPT = `You are a commit message generator.

Analyze the git diff and generate commit messages.

Rules:
- Follow Conventional Commits: type(scope): description
- Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
- Title under 72 characters
- Split into multiple commits when changes are logically separate
- Group related file changes into single commit when appropriate
- NEVER include Jira ticket numbers (like AS-123, PROJ-456) in titles or messages
- Jira tickets are assigned separately via the [t] option

Language settings (check the input for TITLE_LANG and MESSAGE_LANG):
- TITLE_LANG: Language for commit title (after the type(scope): prefix)
- MESSAGE_LANG: Language for detailed message
- Default: title in English, message in Korean

Examples:
- Title (en): "feat(auth): add OAuth login support"
- Title (ko): "feat(auth): OAuth 로그인 지원 추가"
- Message (en): "Implemented OAuth 2.0 flow with Google provider"
- Message (ko): "Google OAuth 2.0 인증 흐름 구현"

Output ONLY valid JSON matching the required schema. No other text.`;

const CLAUDE_REGROUP_PROMPT = `You are a commit message regrouper.

Your task is to merge commits that share the same Jira ticket URL into a single commit.

Rules:
1. Commits with the SAME Jira URL must be merged into ONE commit
2. Combine all files from the merged commits
3. Create a new summarized title that covers all merged changes
4. Create a new summarized message that describes all combined changes
5. Keep the Jira URL in the merged commit (jira_url field)
6. Commits WITHOUT a Jira URL should remain unchanged
7. Follow Conventional Commits: type(scope): description
8. Title under 72 characters

Language settings (check the input for TITLE_LANG and MESSAGE_LANG):
- TITLE_LANG: Language for commit title
- MESSAGE_LANG: Language for detailed message

Output ONLY valid JSON matching the required schema. No other text.`;

// Cursor CLI prompts (delimiter format)
const CURSOR_COMMIT_PROMPT = `You are a commit message generator. Analyze git changes and generate commit messages.

IMPORTANT: You MUST reply ONLY in the EXACT format below. No markdown, no explanation, no other text.

===COMMIT===
FILES: file1.ts, file2.ts
TITLE: type(scope): description
MESSAGE: detailed message here

RULES:
1. Each commit block MUST start with ===COMMIT=== on its own line
2. FILES: comma-separated file paths (use ONLY files from the input, NEVER invent files)
3. TITLE: follow Conventional Commits format, under 72 characters
4. MESSAGE: detailed description in specified language
5. You may output multiple ===COMMIT=== blocks for separate logical changes
6. Group related files into the same commit
7. NEVER include Jira ticket numbers in titles or messages

Conventional Commit Types:
- feat: new feature
- fix: bug fix
- docs: documentation
- style: formatting (no code change)
- refactor: code restructuring
- test: adding tests
- chore: maintenance
- perf: performance improvement
- ci: CI/CD changes
- build: build system changes

Language Settings (check input for TITLE_LANG and MESSAGE_LANG):
- TITLE_LANG: en = English title, ko = Korean title
- MESSAGE_LANG: en = English message, ko = Korean message

Example Output:
===COMMIT===
FILES: src/auth/login.ts, src/auth/logout.ts
TITLE: feat(auth): add OAuth login support
MESSAGE: OAuth 2.0 인증 흐름을 구현하고 로그아웃 처리를 추가했습니다.
===COMMIT===
FILES: src/utils/helper.ts
TITLE: chore(utils): add helper functions
MESSAGE: 공통 유틸리티 함수를 추가했습니다.`;

const CURSOR_REGROUP_PROMPT = `You are a commit message regrouper. Merge commits with the same Jira ticket into a single commit.

IMPORTANT: You MUST reply ONLY in the EXACT format below. No markdown, no explanation, no other text.

===COMMIT===
FILES: file1.ts, file2.ts
TITLE: type(scope): description (JIRA-123)
MESSAGE: detailed message here

RULES:
1. Merge all commits with the SAME Jira key into ONE commit
2. Combine all files from merged commits (no duplicates)
3. Create a summarized title covering all merged changes
4. Add the Jira key at the end of the title: "description (AS-123)"
5. Create a summarized message describing all combined changes
6. Follow Conventional Commits format
7. Title under 72 characters

Language Settings (check input for TITLE_LANG and MESSAGE_LANG):
- TITLE_LANG: en = English title, ko = Korean title
- MESSAGE_LANG: en = English message, ko = Korean message

Example Output:
===COMMIT===
FILES: src/components/Button.tsx, src/components/Input.tsx
TITLE: feat(ui): add Button and Input components (AS-123)
MESSAGE: Button과 Input 컴포넌트를 추가했습니다.`;

// JSON Schema for Claude output
const COMMIT_SCHEMA = {
  type: 'object',
  properties: {
    commits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
          },
          title: { type: 'string' },
          message: { type: 'string' },
          jira_key: { type: 'string' },
        },
        required: ['files', 'title', 'message'],
      },
    },
  },
  required: ['commits'],
};

/**
 * Get prompt template for a provider and category
 */
export function getPromptTemplate(
  provider: ProviderPromptType,
  category: PromptCategory
): string {
  if (provider === 'claude') {
    return category === 'commit' ? CLAUDE_COMMIT_PROMPT : CLAUDE_REGROUP_PROMPT;
  } else {
    return category === 'commit' ? CURSOR_COMMIT_PROMPT : CURSOR_REGROUP_PROMPT;
  }
}

/**
 * Get JSON schema for structured output
 */
export function getJsonSchema(): object {
  return COMMIT_SCHEMA;
}
