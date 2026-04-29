/**
 * Cluster-aware chunking: groups structurally related files via the import
 * graph, then bin-packs the clusters into chunks that fit the per-call
 * input budget.
 *
 * The cluster step computes Weakly Connected Components on the import graph
 * (treated as undirected). Files outside the graph — no edges in or out —
 * become singleton clusters. The pack step is First-Fit Decreasing: sort
 * clusters by combined cost descending, then place each into the first
 * existing chunk it fits, opening a new chunk only when none fits. FFD is
 * provably within ~22% of the optimal bin count, sufficient for the
 * tens-to-hundreds chunk regime we operate in.
 *
 * Coverage is preserved by construction. A cluster that exceeds the per-
 * chunk budget is decomposed into its individual files and re-packed; we
 * sacrifice cluster cohesion before we sacrifice coverage. A single file
 * larger than the budget gets its own chunk (the existing chunker behavior:
 * the file is included, its diff is truncated downstream).
 *
 * Determinism: equal inputs always produce equal output. Components are
 * discovered in alphabetical-file order; ties in pack ordering are broken
 * by lowest file path.
 */

import type { GitChange } from '../types/git.js';
import {
  estimateTreeLineCost,
  TREE_BASE_OVERHEAD,
  DEFAULT_SAFETY_MARGIN,
  type Chunk,
  type ChunkBudget,
} from './chunk.js';

export interface Cluster {
  /** Member changes, sorted by file path for deterministic packing. */
  changes: GitChange[];
  /** Summed diff bytes across the cluster. */
  diffSize: number;
  /** Summed tree-line bytes across the cluster (excludes scaffolding). */
  treeSize: number;
}

/**
 * Build the undirected adjacency for component discovery. The import graph
 * is directed (importer -> imported); for clustering we want both
 * directions in one set so a single BFS catches the whole component.
 */
function buildUndirectedAdjacency(
  graph: Map<string, Set<string>>
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const ensure = (k: string): Set<string> => {
    let s = adj.get(k);
    if (!s) {
      s = new Set();
      adj.set(k, s);
    }
    return s;
  };

  for (const [from, outs] of graph) {
    ensure(from);
    for (const to of outs) {
      ensure(from).add(to);
      ensure(to).add(from);
    }
  }
  return adj;
}

/**
 * Compute Weakly Connected Components over the change set, using the import
 * graph as adjacency. Files not present in the graph still produce
 * singleton clusters so coverage is total.
 *
 * Order:
 *  - clusters are returned sorted by their lowest member file path
 *  - changes within each cluster are sorted by file path
 *
 * That double sort makes the output deterministic regardless of the
 * iteration order of the input Map / Set.
 */
export function computeClusters(
  changes: GitChange[],
  diffs: Map<string, string>,
  graph: Map<string, Set<string>>
): Cluster[] {
  if (changes.length === 0) return [];

  const byFile = new Map<string, GitChange>();
  for (const c of changes) byFile.set(c.file, c);

  const adj = buildUndirectedAdjacency(graph);
  const visited = new Set<string>();
  const components: GitChange[][] = [];

  // Walk files in alphabetical order so component discovery is deterministic
  // even when the graph's Map iteration order varies.
  const files = [...byFile.keys()].sort();

  for (const seed of files) {
    if (visited.has(seed)) continue;
    const memberFiles: string[] = [];
    const stack: string[] = [seed];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      // Only include nodes that are part of the change set; the graph may
      // surface paths the cluster never owned (defensive — shouldn't occur
      // when graph is built from the same change set, but guards against
      // misuse).
      if (!byFile.has(node)) continue;
      memberFiles.push(node);

      const neighbors = adj.get(node);
      if (!neighbors) continue;
      // Sort neighbor traversal too so the in-component visit order is
      // deterministic. Doesn't change membership, just which neighbor
      // pops first.
      const sortedNeighbors = [...neighbors].sort();
      for (const n of sortedNeighbors) {
        if (!visited.has(n)) stack.push(n);
      }
    }

    if (memberFiles.length > 0) {
      memberFiles.sort();
      components.push(memberFiles.map((f) => byFile.get(f)!));
    }
  }

  // Sort components by their lowest file path (already sorted within).
  components.sort((a, b) => a[0].file.localeCompare(b[0].file));

  return components.map((member) => ({
    changes: member,
    diffSize: member.reduce(
      (sum, c) => sum + (diffs.get(c.file)?.length ?? 0),
      0
    ),
    treeSize: member.reduce((sum, c) => sum + estimateTreeLineCost(c), 0),
  }));
}

/**
 * Build a single-file cluster — used when a larger cluster overflows and
 * has to be decomposed file-by-file to preserve coverage.
 */
function singletonCluster(
  change: GitChange,
  diffs: Map<string, string>
): Cluster {
  return {
    changes: [change],
    diffSize: diffs.get(change.file)?.length ?? 0,
    treeSize: estimateTreeLineCost(change),
  };
}

/**
 * First-Fit Decreasing bin packing over clusters. Each cluster lands fully
 * in one chunk if it fits; otherwise it is decomposed into single-file
 * clusters and re-packed (those singletons may then scatter across chunks,
 * but coverage holds).
 *
 * The diffs map is required so cluster decomposition can re-derive the
 * per-file weight (the cluster's `diffSize` is a sum, not a per-member
 * breakdown).
 */
export function packClusters(
  clusters: Cluster[],
  diffs: Map<string, string>,
  budget: ChunkBudget
): Chunk[] {
  if (clusters.length === 0) return [];

  const margin = budget.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const diffCap = Math.max(1, Math.floor(budget.maxDiffSize * (1 - margin)));
  const treeCap = Math.max(
    1,
    Math.floor((budget.treeBudget - TREE_BASE_OVERHEAD) * (1 - margin))
  );

  // Sort by combined cost descending. FFD is sensitive to the weight metric;
  // summing diff and tree mirrors how both caps gate placement, so the
  // heaviest clusters by either dimension get first crack at the bins.
  const sorted = [...clusters].sort((a, b) => {
    const aw = a.diffSize + a.treeSize;
    const bw = b.diffSize + b.treeSize;
    if (aw !== bw) return bw - aw;
    // Stable tie-break: lowest file path first.
    return a.changes[0].file.localeCompare(b.changes[0].file);
  });

  type OpenChunk = {
    changes: GitChange[];
    diffSize: number;
    treeSize: number;
  };
  const open: OpenChunk[] = [];

  const fitsIn = (chunk: OpenChunk, cluster: Cluster): boolean =>
    chunk.diffSize + cluster.diffSize <= diffCap &&
    chunk.treeSize + cluster.treeSize <= treeCap;

  const place = (cluster: Cluster): boolean => {
    for (const chunk of open) {
      if (fitsIn(chunk, cluster)) {
        chunk.changes.push(...cluster.changes);
        chunk.diffSize += cluster.diffSize;
        chunk.treeSize += cluster.treeSize;
        return true;
      }
    }
    return false;
  };

  for (const cluster of sorted) {
    if (place(cluster)) continue;

    // Cluster doesn't fit any existing chunk. If it fits a fresh chunk on
    // its own, open one. If it's bigger than a fresh chunk too, decompose
    // and re-pack the singletons.
    if (cluster.diffSize <= diffCap && cluster.treeSize <= treeCap) {
      open.push({
        changes: [...cluster.changes],
        diffSize: cluster.diffSize,
        treeSize: cluster.treeSize,
      });
      continue;
    }

    // Decomposition path. Sort singletons by weight desc so they themselves
    // pack via FFD across the open chunks (and any new ones we open).
    const singletons = cluster.changes
      .map((c) => singletonCluster(c, diffs))
      .sort((a, b) => {
        const aw = a.diffSize + a.treeSize;
        const bw = b.diffSize + b.treeSize;
        if (aw !== bw) return bw - aw;
        return a.changes[0].file.localeCompare(b.changes[0].file);
      });

    for (const single of singletons) {
      if (place(single)) continue;
      // A single file bigger than the cap still gets its own chunk —
      // truncation downstream is preferable to losing coverage.
      open.push({
        changes: [...single.changes],
        diffSize: single.diffSize,
        treeSize: single.treeSize,
      });
    }
  }

  return open.map((c, i) => ({
    index: i,
    changes: c.changes,
    estimatedDiffSize: c.diffSize,
    estimatedTreeSize: c.treeSize + TREE_BASE_OVERHEAD,
  }));
}

/**
 * End-to-end cluster-aware chunk planner: composes computeClusters and
 * packClusters so callers (the generate command in particular) hit a single
 * entry point. Equivalent to chunk.ts's planChunks but routes through the
 * import graph instead of directory adjacency.
 *
 * Kept separate from planChunks rather than overloading it: chunk.ts has no
 * dependency on the graph, and adding one would create a cycle through
 * cluster.ts. The caller picks based on whether a graph is available.
 */
export function planClusteredChunks(
  changes: GitChange[],
  diffs: Map<string, string>,
  graph: Map<string, Set<string>>,
  budget: ChunkBudget
): Chunk[] {
  const clusters = computeClusters(changes, diffs, graph);
  return packClusters(clusters, diffs, budget);
}
