/**
 * Git-related type definitions
 */

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | '?';

export interface GitChange {
  file: string;
  status: ChangeStatus;
}

export interface GitStats {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
  total: number;
}

export interface GitDiffResult {
  branch: string;
  changes: GitChange[];
  stats: GitStats;
  treeSummary: string;
  diffContent: string;
  validFiles: Set<string>;
}

export interface DiffOptions {
  maxInputSize: number;
  maxDiffSize: number;
  treeDepth: number;
}
