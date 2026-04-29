/**
 * Changeset chunking for unbounded multi-pass commit generation.
 *
 * For changesets too large to fit in a single AI input budget, the file list
 * is partitioned into ordered chunks and the AI is called once per chunk.
 * Coverage is guaranteed by construction: every changed file is assigned to
 * exactly one chunk, so the union of per-chunk responses always covers the
 * full set. The previous single-call design rejected the entire commit flow
 * if even one of N changed files exceeded the input budget; chunking removes
 * that hard cap.
 *
 * The chunker is directory-aware: files sharing a parent directory are kept
 * adjacent so each chunk's commits stay locally coherent (a refactor that
 * spans multiple directories may still split across chunks, which is the
 * acceptable tradeoff for unbounded scale).
 */

import type { GitChange } from '../types/git.js';

export interface ChunkBudget {
  /** Hard cap on the diff section per chunk, in bytes. */
  maxDiffSize: number;
  /** Hard cap on the tree-summary section per chunk, in bytes. */
  treeBudget: number;
  /**
   * Soft margin (0.0–0.5) applied to both caps so an estimation error
   * does not push a chunk over the real input limit. Defaults to 10%.
   */
  safetyMargin?: number;
}

export interface Chunk {
  index: number;
  changes: GitChange[];
  estimatedDiffSize: number;
  estimatedTreeSize: number;
}

const DEFAULT_SAFETY_MARGIN = 0.1;

/**
 * Fixed cost of the tree-summary scaffolding (CHANGE SUMMARY header, FILE
 * LIST header, up to five per-status section headers). Subtracted from the
 * tree budget before fitting file lines so the scaffolding never pushes a
 * chunk over.
 */
const TREE_BASE_OVERHEAD = 400;

/** Re-exported so the cluster step can size groups against the same cost
 * model the chunker uses. Treat as internal — not part of the public API. */
export { estimateTreeLineCost, TREE_BASE_OVERHEAD, DEFAULT_SAFETY_MARGIN };

/**
 * Estimate the tree-summary cost for a single change line, including status
 * prefix and trailing newline. Renames carry both old and new paths.
 */
function estimateTreeLineCost(change: GitChange): number {
  if (change.status === 'R' && change.from) {
    return change.from.length + change.file.length + 6;
  }
  return change.file.length + 3;
}

/**
 * Sort changes by directory depth, then alphabetically. Files in the same
 * directory cluster together so the chunker's greedy fill places related
 * files in the same chunk before flipping to the next directory. Order is
 * deterministic so the same input always yields the same plan.
 */
function sortChanges(changes: GitChange[]): GitChange[] {
  return [...changes].sort((a, b) => {
    const ad = a.file.split('/').length;
    const bd = b.file.split('/').length;
    if (ad !== bd) return ad - bd;
    return a.file.localeCompare(b.file);
  });
}

/**
 * Partition changes into chunks that each fit within the budget.
 *
 * Greedy fill: walk the sorted change list and accumulate into the current
 * chunk until adding the next file would push tree or diff over its
 * margin-adjusted cap, then emit and start a new chunk. A single file with a
 * diff larger than the cap gets its own chunk; the diff is truncated
 * downstream rather than dropping the file entirely — losing one file from
 * coverage is worse than feeding the AI a clipped diff.
 */
export function planChunks(
  changes: GitChange[],
  diffs: Map<string, string>,
  budget: ChunkBudget
): Chunk[] {
  if (changes.length === 0) return [];

  const margin = budget.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const diffCap = Math.max(1, Math.floor(budget.maxDiffSize * (1 - margin)));
  const treeCap = Math.max(
    1,
    Math.floor((budget.treeBudget - TREE_BASE_OVERHEAD) * (1 - margin))
  );

  const sorted = sortChanges(changes);
  const chunks: Chunk[] = [];
  let current: GitChange[] = [];
  let currentDiff = 0;
  let currentTree = 0;

  const emit = (): void => {
    if (current.length === 0) return;
    chunks.push({
      index: chunks.length,
      changes: current,
      estimatedDiffSize: currentDiff,
      estimatedTreeSize: currentTree + TREE_BASE_OVERHEAD,
    });
    current = [];
    currentDiff = 0;
    currentTree = 0;
  };

  for (const change of sorted) {
    const treeCost = estimateTreeLineCost(change);
    const diffCost = diffs.get(change.file)?.length ?? 0;

    const wouldOverflow =
      current.length > 0 &&
      (currentDiff + diffCost > diffCap || currentTree + treeCost > treeCap);

    if (wouldOverflow) {
      emit();
    }

    current.push(change);
    currentDiff += diffCost;
    currentTree += treeCost;
  }

  emit();
  return chunks;
}

/**
 * Convenience: collect every file path covered by the chunk, including the
 * `from` path of any rename (so coverage validation matches `validFiles`,
 * which `getAllChangedFiles` populates with both sides of a rename).
 */
export function chunkFiles(chunk: Chunk): string[] {
  const files: string[] = [];
  for (const c of chunk.changes) {
    files.push(c.file);
    if (c.from) files.push(c.from);
  }
  return files;
}
