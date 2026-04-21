/**
 * Commit validation and normalization.
 *
 * The AI may return synthetic paths that the tree summary no longer produces
 * (legacy compressed labels like "dir/ [N files: ...]") or paths that never
 * existed in the change list (hallucinations). These must be dropped BEFORE
 * staging, otherwise `git add` fails on them and real files get left behind.
 *
 * In addition, every file in the change list must be covered by exactly one
 * commit. Coverage gaps abort the commit flow; cross-commit duplicates are
 * resolved by first-commit-wins so `git commit` does not see an empty index
 * on the second occurrence.
 */

import type { Commit } from '../types/commit.js';
import { logger } from './logger.js';

const MAX_TITLE_LENGTH = 72;

/**
 * Legacy compressed tree-summary label, e.g. `src/foo/ [15 files: 15 *.ts]`.
 * Kept as a recognized pattern so even an AI trained on old outputs gets its
 * nonsense paths stripped cleanly before the directory-prefix expansion.
 */
const COMPRESSED_LABEL = /\s*\[\s*\d+\s*files?(?::[^\]]*)?\s*\]\s*$/;

export function validateTitleLength(commits: Commit[]): void {
  commits.forEach((commit, i) => {
    if (commit.title.length > MAX_TITLE_LENGTH) {
      logger.warning(
        `Commit ${i + 1} title exceeds ${MAX_TITLE_LENGTH} chars (${commit.title.length} chars)`
      );
    }
  });
}

/**
 * Resolve a commit-file entry to the set of real files it represents:
 * - exact path match → itself
 * - legacy compressed label stripped + directory prefix → every real file under it
 * - bare directory prefix ("src/foo" or "src/foo/") → every real file under it
 * - anything else → empty (hallucination)
 */
function resolveToValidFiles(
  commitFile: string,
  validFiles: Set<string>,
  validArray: string[]
): string[] {
  if (validFiles.has(commitFile)) {
    return [commitFile];
  }

  const cleaned = commitFile.replace(COMPRESSED_LABEL, '').trim();

  if (!cleaned) {
    return [];
  }

  if (validFiles.has(cleaned)) {
    return [cleaned];
  }

  const dirPrefix = cleaned.endsWith('/') ? cleaned : cleaned + '/';
  return validArray.filter((v) => v.startsWith(dirPrefix));
}

export interface NormalizedCommits {
  commits: Commit[];
  dropped: string[];
  duplicates: string[];
  missing: string[];
}

/**
 * Normalize commits against the real change list.
 *
 * - Unresolvable entries are dropped and reported in `dropped`.
 * - Cross-commit duplicates are resolved first-commit-wins and reported in
 *   `duplicates` (otherwise a later commit would hit an empty index when its
 *   only file was already committed by an earlier one).
 * - Commits that end up empty after filtering are removed from the output.
 * - Real changed files not covered by any commit are reported in `missing`;
 *   the caller must abort the commit flow when this is non-empty.
 */
export function normalizeCommits(
  commits: Commit[],
  validFiles: Set<string>
): NormalizedCommits {
  const validArray = [...validFiles];
  const dropped = new Set<string>();
  const duplicates = new Set<string>();
  const coveredFiles = new Set<string>();

  const normalized: Commit[] = [];

  for (const commit of commits) {
    const resolved: string[] = [];
    const seenInCommit = new Set<string>();

    for (const file of commit.files) {
      const matches = resolveToValidFiles(file, validFiles, validArray);

      if (matches.length === 0) {
        dropped.add(file);
        continue;
      }

      for (const m of matches) {
        if (seenInCommit.has(m)) {
          continue;
        }
        seenInCommit.add(m);

        if (coveredFiles.has(m)) {
          duplicates.add(m);
          continue;
        }

        coveredFiles.add(m);
        resolved.push(m);
      }
    }

    if (resolved.length > 0) {
      normalized.push({ ...commit, files: resolved });
    }
  }

  const missing = validArray.filter((f) => !coveredFiles.has(f));

  return {
    commits: normalized,
    dropped: [...dropped],
    duplicates: [...duplicates],
    missing,
  };
}

export function isValidConventionalCommit(title: string): boolean {
  const pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build)(\([^)]+\))?:\s.+/;
  return pattern.test(title);
}
