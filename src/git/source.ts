/**
 * Bulk source-content loader for the import-graph builder.
 *
 * Reads the working-tree contents of every changed file whose extension we
 * can parse for imports. Files that are deleted, missing, oversized, or have
 * an unsupported extension are skipped silently — they still appear in the
 * change set but contribute no edges to the graph (so they cluster as
 * singletons).
 *
 * The working tree is consistent with the staged state because the generate
 * flow runs `stageAllChanges` before any chunk planning. Reading via fs is
 * meaningfully faster than `git show :path` per file (no subprocess fork
 * cost), which matters at the 10⁴-file scale this design targets.
 *
 * Reads are batched to bound the simultaneous file-descriptor count; without
 * the batch the OS limit (~256 on default macOS) becomes the bottleneck and
 * Node throws EMFILE on large changesets.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitChange } from '../types/git.js';
import { detectSourceLanguage } from './imports.js';

/** Skip any single file larger than this when reading content for graph
 * building. Bundles, lockfiles, and minified vendor code can blow memory and
 * are rarely useful for import extraction. The graph treats them as singletons. */
const MAX_FILE_BYTES = 1_000_000;

/** Concurrency cap for parallel reads. The OS file-descriptor limit on a
 * default macOS install is 256; staying well under that prevents EMFILE on
 * large changesets without serializing the whole load. */
const READ_BATCH = 50;

export async function loadSourceContents(
  changes: GitChange[],
  cwd?: string
): Promise<Map<string, string>> {
  const root = cwd ?? process.cwd();
  const contents = new Map<string, string>();

  // Skip deleted files (no working-tree content) and unsupported extensions
  // (no parser would extract imports anyway).
  const targets = changes.filter(
    (c) => c.status !== 'D' && detectSourceLanguage(c.file) !== 'unknown'
  );

  for (let i = 0; i < targets.length; i += READ_BATCH) {
    const batch = targets.slice(i, i + READ_BATCH);
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          const fullPath = path.resolve(root, c.file);
          const stat = await fs.stat(fullPath);
          if (stat.size > MAX_FILE_BYTES) return null;
          const content = await fs.readFile(fullPath, 'utf-8');
          return [c.file, content] as const;
        } catch {
          // Missing, unreadable, or non-UTF8 — skip; the file still exists
          // in the change set and will cluster as a singleton.
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) contents.set(r[0], r[1]);
    }
  }

  return contents;
}
