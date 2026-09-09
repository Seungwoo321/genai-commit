/**
 * Model discovery and resolution.
 *
 * The catalog of available models belongs to the provider CLI, not to this
 * package. Keeping a copy here guarantees divergence: every hardcoded slug this
 * package shipped (gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2, and the eight
 * cursor entries) had already been retired by the provider, so the built-in
 * default produced a hard 400 instead of a commit message.
 *
 * So this module owns an *intent* — "generating a commit message is a low-tier
 * job, use the smallest model the input fits into" — and resolves that intent
 * against whatever the provider exposes at run time.
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { execSimple } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import type { ProviderType } from './types.js';

export interface DiscoveredModel {
  slug: string;
  displayName?: string;
  description?: string;
  /** Context window in tokens. Undefined when the provider does not expose one. */
  contextWindow?: number;
  /**
   * The provider's own ordering, lowest number = most prominent (its flagship).
   * Used only to break ties, so a fallback steps to the next cheapest model
   * rather than jumping to the flagship that happens to share a window size.
   */
  priority?: number;
  /** Reasoning efforts the model accepts, when the provider publishes them. */
  reasoningLevels?: string[];
}

export interface ModelDiscovery {
  models: DiscoveredModel[];
  /** Where the list came from, shown by `genai-commit models <provider>`. */
  source: string;
  /** Set when discovery failed. `models` is then empty — there is no fallback list. */
  error?: string;
}

/**
 * Claude Code exposes no listing surface (`claude models` is not a command and
 * an invalid `--model` reports no catalog). Its aliases are the substitute, and
 * a deliberate one: `--help` documents them as "an alias for the latest model",
 * so `haiku` keeps resolving to the current Haiku without this package changing.
 * These strings are therefore a tier vocabulary, not a model catalog.
 */
const CLAUDE_TIER_ALIASES: DiscoveredModel[] = [
  { slug: 'haiku', displayName: 'Haiku', description: 'Smallest tier — alias for the latest Haiku' },
  { slug: 'sonnet', displayName: 'Sonnet', description: 'Balanced tier — alias for the latest Sonnet' },
  { slug: 'opus', displayName: 'Opus', description: 'Largest tier — alias for the latest Opus' },
];

/**
 * Characters per token. Deliberately pessimistic: Korean prose and dense diffs
 * tokenize far worse than the ~4 chars/token that holds for English prose, and
 * the two errors are not symmetric — over-estimating picks a slightly roomier
 * model, under-estimating overflows the window mid-run and loses the whole call.
 */
const CHARS_PER_TOKEN = 2.5;
/** Room for the model's own reply; commit blocks for a large chunk are not small. */
const OUTPUT_RESERVE_TOKENS = 4000;

export function estimateRequiredTokens(inputChars: number): number {
  return Math.ceil(inputChars / CHARS_PER_TOKEN) + OUTPUT_RESERVE_TOKENS;
}

/**
 * Slug fragments that providers use to mark a cheaper or smaller variant.
 * Only consulted when the provider publishes no context window (cursor), and
 * only to order candidates — a wrong guess costs one rejected attempt, which
 * `nextCandidate` absorbs.
 */
const SMALL_TIER_HINTS = ['spark', 'mini', 'lite', 'flash', 'haiku', 'low', 'fast'];

function tierHint(slug: string): number {
  const s = slug.toLowerCase();
  if (s === 'auto') return 1; // provider routes it itself
  return SMALL_TIER_HINTS.some((h) => s.includes(h)) ? 0 : 2;
}

/**
 * Order the models to try, cheapest-that-fits first.
 *
 * Models that publish a context window are ranked by it ascending, keeping only
 * those the input fits into; if nothing fits, the roomiest is tried anyway so the
 * provider — not a guess made here — decides whether the call is too big.
 * Models with no published window follow, ordered by slug hint then provider order.
 */
export function rankCandidates(discovery: ModelDiscovery, requiredTokens: number): string[] {
  const sized = discovery.models.filter((m) => typeof m.contextWindow === 'number');
  const unsized = discovery.models.filter((m) => typeof m.contextWindow !== 'number');

  const byWindow = [...sized].sort(
    (a, b) =>
      a.contextWindow! - b.contextWindow! ||
      // Same window: take the provider's less-prominent model first. Without this
      // a rejected first choice escalates straight to the flagship.
      (b.priority ?? 0) - (a.priority ?? 0)
  );
  const fitting = byWindow.filter((m) => m.contextWindow! >= requiredTokens);
  const sizedOrder = fitting.length > 0 ? fitting : byWindow.slice(-1);

  const unsizedOrder = unsized
    .map((m, i) => ({ m, i }))
    .sort((a, b) => tierHint(a.m.slug) - tierHint(b.m.slug) || a.i - b.i)
    .map((x) => x.m);

  return [...sizedOrder, ...unsizedOrder].map((m) => m.slug);
}

/** Codex keeps its account-visible catalog in a cache the CLI itself refreshes. */
async function discoverCodex(): Promise<ModelDiscovery> {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const path = join(home, 'models_cache.json');
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as {
      models?: Array<Record<string, unknown>>;
    };
    const models = (raw.models ?? [])
      // `hide` entries are internal (review models, reserves) and are not offered
      // in the CLI's own picker either.
      .filter((m) => m.visibility === 'list')
      .map((m) => ({
        slug: String(m.slug),
        displayName: typeof m.display_name === 'string' ? m.display_name : undefined,
        description: typeof m.description === 'string' ? m.description : undefined,
        contextWindow: typeof m.context_window === 'number' ? m.context_window : undefined,
        priority: typeof m.priority === 'number' ? m.priority : undefined,
        reasoningLevels: Array.isArray(m.supported_reasoning_levels)
          ? (m.supported_reasoning_levels as Array<Record<string, unknown>>)
              .map((r) => (typeof r?.effort === 'string' ? r.effort : ''))
              .filter(Boolean)
          : undefined,
      }))
      .filter((m) => m.slug && m.slug !== 'undefined');
    if (models.length === 0) {
      return { models: [], source: path, error: 'cache contains no listable models' };
    }
    return { models, source: path };
  } catch (e) {
    return {
      models: [],
      source: path,
      error: `could not read Codex model cache (${(e as Error).message}). Run \`codex\` once to populate it.`,
    };
  }
}

/** Cursor publishes a first-class listing command; it carries no context windows. */
async function discoverCursor(): Promise<ModelDiscovery> {
  const source = 'agent --list-models';
  try {
    const out = await execSimple('agent', ['--list-models'], { timeout: 30000 });
    const models: DiscoveredModel[] = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\S+)\s+-\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const slug = m[1];
      if (slug.toLowerCase() === 'available') continue; // header line
      models.push({ slug, displayName: m[2].replace(/\s*\(default\)\s*$/, '') });
    }
    if (models.length === 0) {
      return { models: [], source, error: 'command produced no parsable model lines' };
    }
    return { models, source };
  } catch (e) {
    return { models: [], source, error: `could not list Cursor models (${(e as Error).message})` };
  }
}

function discoverClaude(): ModelDiscovery {
  return { models: CLAUDE_TIER_ALIASES, source: 'claude --model aliases (no listing surface)' };
}

const cache = new Map<ProviderType, Promise<ModelDiscovery>>();

/**
 * Discovery is per-process cached: a run generates one call per chunk and the
 * catalog cannot change underneath a single run.
 */
export function discoverModels(provider: ProviderType): Promise<ModelDiscovery> {
  let hit = cache.get(provider);
  if (!hit) {
    hit =
      provider === 'codex-cli'
        ? discoverCodex()
        : provider === 'cursor-cli'
          ? discoverCursor()
          : Promise.resolve(discoverClaude());
    cache.set(provider, hit);
  }
  return hit;
}

/** Test seam — discovery is cached for the life of the process. */
export function clearDiscoveryCache(): void {
  cache.clear();
}

/**
 * Does this failure mean "that model is not usable", as opposed to a real error?
 * Only such failures may advance to the next candidate; retrying a rate limit or
 * a network fault against a different model would just burn the candidate list.
 */
export function isModelRejection(message: string): boolean {
  const m = message.toLowerCase();
  const mentionsModel = m.includes('model');
  const rejected =
    m.includes('not supported') ||
    m.includes('not found') ||
    m.includes('unrecognized') ||
    m.includes("isn't described") ||
    m.includes('does not exist') ||
    m.includes('may not exist') ||
    m.includes('invalid_request_error') ||
    m.includes('unknown model') ||
    m.includes('no access') ||
    m.includes('context length') ||
    m.includes('context window') ||
    m.includes('too long');
  return mentionsModel && rejected;
}

/**
 * Run `attempt` against the best candidate model, stepping to the next one only
 * when the provider says *that model* is unusable.
 *
 * This is what makes a wrong ranking survivable: the ordering above is inferred
 * from whatever metadata the provider happens to publish, and no provider
 * publishes a cost or tier field. A mis-ranked first choice therefore costs one
 * rejected call, not a failed run — which is the difference between this and the
 * hardcoded default it replaces, where a single stale slug ended the run.
 *
 * An explicit `--model` is never overridden. The user naming a model is a
 * decision, and quietly substituting a different one would hide it.
 */
export async function withModelFallback<T>(opts: {
  provider: ProviderType;
  explicitModel?: string;
  inputChars: number;
  attempt: (model: string) => Promise<T>;
  onSelect?: (model: string, attemptNo: number) => void;
}): Promise<T> {
  const { provider, explicitModel, inputChars, attempt, onSelect } = opts;

  if (explicitModel) {
    onSelect?.(explicitModel, 1);
    return attempt(explicitModel);
  }

  const discovery = await discoverModels(provider);
  if (discovery.error) {
    // No hardcoded fallback list: reinstating one would rebuild the exact defect
    // this module exists to remove.
    throw new Error(
      `Cannot determine an available model for ${provider}: ${discovery.error}
` +
        `Pass --model <name> explicitly, or see: genai-commit models ${provider}`,
    );
  }

  const candidates = rankCandidates(discovery, estimateRequiredTokens(inputChars));
  if (candidates.length === 0) {
    throw new Error(`No usable model found for ${provider} (source: ${discovery.source})`);
  }

  let lastError: Error | undefined;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    onSelect?.(model, i + 1);
    try {
      return await attempt(model);
    } catch (e) {
      const err = e as Error;
      if (!isModelRejection(err.message)) throw err;
      lastError = err;
    }
  }
  throw new Error(
    `Every candidate model was rejected by ${provider} (tried: ${candidates.join(', ')}).\n` +
      `Last error: ${lastError?.message ?? 'unknown'}`,
  );
}

/**
 * Report which model a run settled on. Generation is called once per chunk, so
 * the selection is announced when it changes rather than on every call; a
 * fallback step is always announced because it explains a slower run.
 */
const lastReported = new Map<ProviderType, string>();

export function reportModel(provider: ProviderType) {
  return (model: string, attemptNo: number): void => {
    if (attemptNo > 1) {
      logger.warning(`  ↳ ${model} (candidate ${attemptNo} — previous model was rejected)`);
      lastReported.set(provider, model);
      return;
    }
    if (lastReported.get(provider) !== model) {
      logger.dim(`  model: ${model}`);
      lastReported.set(provider, model);
    }
  };
}

/** Test seam. */
export function clearModelReportState(): void {
  lastReported.clear();
}

/**
 * Reasoning effort, weakest first.
 *
 * This is an ordinal vocabulary, not a model catalog — providers add models far
 * more often than they add effort levels, and an unknown level simply never
 * matches. Writing a commit message does not need deep reasoning, and inheriting
 * whatever the user set globally both costs more and breaks outright: a machine
 * configured with `model_reasoning_effort = "max"` cannot run the small models,
 * because only the large ones accept `max`.
 */
const EFFORT_WEAKEST_FIRST = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/**
 * The cheapest reasoning effort `slug` accepts, or undefined when the provider
 * publishes no levels for it (then the provider's own default stands).
 */
export function resolveReasoningEffort(
  discovery: ModelDiscovery,
  slug: string
): string | undefined {
  const levels = discovery.models.find((m) => m.slug === slug)?.reasoningLevels;
  if (!levels || levels.length === 0) return undefined;
  return EFFORT_WEAKEST_FIRST.find((e) => levels.includes(e)) ?? levels[0];
}
