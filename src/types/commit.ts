/**
 * Commit-related type definitions
 */

export interface Commit {
  files: string[];
  title: string;
  message: string;
  jiraKey?: string;
}

export interface CommitResult {
  commits: Commit[];
}

export type Language = 'en' | 'ko';

export interface CommitGenerationOptions {
  titleLang: Language;
  messageLang: Language;
}
