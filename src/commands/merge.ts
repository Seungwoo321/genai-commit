/**
 * Cross-chunk semantic merge.
 *
 * The chunked generation flow produces commits one chunk at a time, with no
 * cross-chunk visibility. When a single logical change spans multiple
 * chunks (a refactor that bisects the import-graph cluster boundary, or a
 * feature whose files split between parseable and unparseable groups), the
 * AI produces N small commits that should ideally be one. Deterministic
 * code cannot make that judgment — it is exactly the "cases where
 * deterministic logic cannot separate or group" that the architecture
 * delegates back to the LLM.
 *
 * This step takes the union of per-chunk commits and asks the AI to merge
 * the ones that describe the same logical change. The output is validated
 * against the original change set: if the merge drops any covered file,
 * fabricates any path, or overshoots the title cap, the merge is
 * REJECTED and the original per-chunk commits flow through unchanged.
 * Rollback is always safe because the per-chunk commits already passed
 * coverage validation.
 *
 * Skipped when a merge would be a no-op:
 *  - Single chunk → nothing cross-chunk to merge
 *  - Single commit total → nothing to merge against
 *
 * No retry: merge is best-effort. If the AI fails the call or produces
 * invalid output, we keep the per-chunk commits. Doubling the AI cost on a
 * speculative second pass is not worth the marginal recall.
 */

import type { Ora } from 'ora';
import type { AIProvider, ProviderResponse } from '../providers/types.js';
import type { Commit } from '../types/commit.js';
import type { GencoConfig } from '../config/types.js';
import { normalizeCommits } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

const MAX_TITLE_LENGTH = 72;

export interface MergeResult {
  commits: Commit[];
  raw: string;
  input: string;
}

/**
 * Build the AI input for the merge step. The commits are serialized as
 * JSON so the AI sees the same shape it produces — no special parsing,
 * no information loss vs. a free-text description of the commits.
 *
 * The instructional note explicitly tells the AI to keep distinct
 * changes separate; without it the AI tends to over-merge ("when in
 * doubt, merge"), which produces fewer but lower-quality commits.
 */
function buildMergeInput(config: GencoConfig, commits: Commit[]): string {
  const header = `TITLE_LANG: ${config.titleLang}\nMESSAGE_LANG: ${config.messageLang}`;
  const note =
    `[CROSS-CHUNK MERGE] The ${commits.length} commits below were generated ` +
    `independently from chunks of a large changeset. Identify any that ` +
    `describe the SAME logical change and merge them into one. Keep distinct ` +
    `changes separate. Every file in the input MUST appear in exactly one ` +
    `output commit, copied VERBATIM.`;
  const json = JSON.stringify({ commits }, null, 2);
  return `${header}\n\n${note}\n\nINPUT COMMITS:\n${json}`;
}

/**
 * Decide whether the merge step is worth running. Returning false here
 * skips both the AI call and the rollback dance — the per-chunk commits
 * are already final.
 */
export function shouldRunMerge(
  chunkCount: number,
  commits: Commit[]
): boolean {
  if (chunkCount <= 1) return false;
  if (commits.length <= 1) return false;
  return true;
}

/**
 * Run the cross-chunk merge step. Returns the merged commits (and the raw
 * AI artifacts so the interactive loop can echo them) on success; returns
 * null on any failure mode, signaling the caller to keep the per-chunk
 * commits.
 *
 * The returned commits are normalized against `validFiles` — the same
 * coverage check the per-chunk path uses — so any path the AI invented
 * is dropped before the result reaches the executor.
 */
export async function runCrossChunkMerge(
  provider: AIProvider,
  config: GencoConfig,
  commits: Commit[],
  validFiles: Set<string>,
  spinner: Ora
): Promise<MergeResult | null> {
  const input = buildMergeInput(config, commits);
  spinner.text = `Merging ${commits.length} chunk-level commits across chunks...`;

  let response: ProviderResponse;
  try {
    response = await provider.generate(input, 'merge');
  } catch (error) {
    logger.warning(
      `Cross-chunk merge call failed (${String(error)}); keeping per-chunk commits.`
    );
    return null;
  }

  let parsed;
  try {
    parsed = provider.parseResponse(response);
  } catch (error) {
    logger.warning(
      `Cross-chunk merge response unparseable (${String(error)}); keeping per-chunk commits.`
    );
    return null;
  }

  const normalized = normalizeCommits(parsed.commits, validFiles);

  if (normalized.missing.length > 0) {
    logger.warning(
      `Cross-chunk merge dropped ${normalized.missing.length} file(s); ` +
      `rolling back to per-chunk commits.`
    );
    return null;
  }

  const overlong = normalized.commits.filter(
    (c) => c.title.length > MAX_TITLE_LENGTH
  );
  if (overlong.length > 0) {
    logger.warning(
      `Cross-chunk merge produced ${overlong.length} title(s) over ` +
      `${MAX_TITLE_LENGTH} chars; rolling back to per-chunk commits.`
    );
    return null;
  }

  if (normalized.commits.length === 0) {
    logger.warning(
      'Cross-chunk merge produced no commits; rolling back to per-chunk commits.'
    );
    return null;
  }

  return {
    commits: normalized.commits,
    raw: response.raw,
    input,
  };
}
