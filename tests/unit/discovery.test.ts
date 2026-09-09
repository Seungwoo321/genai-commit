import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  estimateRequiredTokens,
  rankCandidates,
  isModelRejection,
  discoverModels,
  clearDiscoveryCache,
  clearModelReportState,
  withModelFallback,
  resolveReasoningEffort,
  type ModelDiscovery,
} from '../../src/providers/discovery.js';

const discovery = (models: ModelDiscovery['models']): ModelDiscovery => ({
  models,
  source: 'test',
});

describe('estimateRequiredTokens', () => {
  it('over-estimates rather than under-estimates', () => {
    // The two errors are not symmetric: a low estimate overflows the window and
    // loses the whole call, a high one just picks a roomier model.
    const naiveEnglishEstimate = 1000 / 4;
    expect(estimateRequiredTokens(1000)).toBeGreaterThan(naiveEnglishEstimate);
  });

  it('reserves room for the reply, not just the prompt', () => {
    expect(estimateRequiredTokens(0)).toBeGreaterThan(0);
  });
});

describe('rankCandidates', () => {
  const models = [
    { slug: 'big', contextWindow: 400_000 },
    { slug: 'small', contextWindow: 100_000 },
    { slug: 'mid', contextWindow: 200_000 },
  ];

  it('picks the smallest model the input fits into', () => {
    expect(rankCandidates(discovery(models), 50_000)[0]).toBe('small');
  });

  it('steps up when the input does not fit the smallest', () => {
    expect(rankCandidates(discovery(models), 150_000)[0]).toBe('mid');
  });

  it('orders the remaining candidates ascending so a rejection falls upward', () => {
    expect(rankCandidates(discovery(models), 50_000)).toEqual(['small', 'mid', 'big']);
  });

  it('still offers the roomiest model when nothing fits, letting the provider decide', () => {
    // Refusing locally would turn a maybe into a certain failure.
    expect(rankCandidates(discovery(models), 900_000)).toEqual(['big']);
  });

  it('ranks models without a published window after sized ones, cheap hints first', () => {
    const mixed = [
      { slug: 'sized', contextWindow: 100_000 },
      { slug: 'plain-model' },
      { slug: 'model-spark' },
      { slug: 'auto' },
    ];
    expect(rankCandidates(discovery(mixed), 1_000)).toEqual([
      'sized',
      'model-spark',
      'auto',
      'plain-model',
    ]);
  });
});

describe('isModelRejection', () => {
  it('recognises the real Codex refusal that motivated this module', () => {
    expect(
      isModelRejection(
        "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account."
      )
    ).toBe(true);
  });

  it('recognises an unknown-model refusal from Claude Code', () => {
    expect(
      isModelRejection("\"__bogus__\" isn't described by this version's model catalog")
    ).toBe(true);
  });

  it('does not treat a rate limit as a model problem', () => {
    // Advancing the candidate list here would burn every model on a fault that
    // has nothing to do with the model.
    expect(isModelRejection('Usage limit reached. Try again later.')).toBe(false);
  });

  it('does not treat a network fault as a model problem', () => {
    expect(isModelRejection('connect ECONNREFUSED 127.0.0.1:443')).toBe(false);
  });
});

describe('discoverModels(codex)', () => {
  let home: string;

  beforeEach(() => {
    clearDiscoveryCache();
    home = mkdtempSync(join(tmpdir(), 'codex-home-'));
    process.env.CODEX_HOME = home;
  });

  afterEach(() => {
    delete process.env.CODEX_HOME;
    rmSync(home, { recursive: true, force: true });
    clearDiscoveryCache();
  });

  it('reads the catalog the CLI itself maintains, keeping only listable models', async () => {
    writeFileSync(
      join(home, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'shown', display_name: 'Shown', visibility: 'list', context_window: 128000 },
          { slug: 'internal', visibility: 'hide', context_window: 272000 },
        ],
      })
    );
    const d = await discoverModels('codex-cli');
    expect(d.error).toBeUndefined();
    expect(d.models.map((m) => m.slug)).toEqual(['shown']);
    expect(d.models[0].contextWindow).toBe(128000);
  });

  it('reports why discovery failed instead of falling back to a built-in list', async () => {
    // A built-in list is exactly what shipped stale slugs; an empty result plus a
    // reason is recoverable, a confidently wrong list is not.
    const d = await discoverModels('codex-cli');
    expect(d.models).toEqual([]);
    expect(d.error).toBeTruthy();
  });
});

describe('withModelFallback', () => {
  beforeEach(() => {
    clearDiscoveryCache();
    clearModelReportState();
  });

  afterEach(() => {
    delete process.env.CODEX_HOME;
    clearDiscoveryCache();
  });

  it('never substitutes a model the user named explicitly', async () => {
    const tried: string[] = [];
    await withModelFallback({
      provider: 'claude-code',
      explicitModel: 'opus',
      inputChars: 10,
      attempt: async (m) => {
        tried.push(m);
        return m;
      },
    });
    expect(tried).toEqual(['opus']);
  });

  it('advances to the next candidate when the provider rejects the model', async () => {
    const tried: string[] = [];
    const result = await withModelFallback({
      provider: 'claude-code',
      inputChars: 10,
      attempt: async (m) => {
        tried.push(m);
        if (tried.length === 1) throw new Error('model not found');
        return m;
      },
    });
    expect(tried.length).toBe(2);
    expect(result).toBe(tried[1]);
  });

  it('propagates a non-model failure without burning the candidate list', async () => {
    const tried: string[] = [];
    await expect(
      withModelFallback({
        provider: 'claude-code',
        inputChars: 10,
        attempt: async (m) => {
          tried.push(m);
          throw new Error('Usage limit reached');
        },
      })
    ).rejects.toThrow('Usage limit reached');
    expect(tried).toEqual(['haiku']);
  });

  it('refuses to guess when discovery failed', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'codex-empty-'));
    mkdirSync(join(empty, 'nothing'), { recursive: true });
    process.env.CODEX_HOME = empty;
    clearDiscoveryCache();
    await expect(
      withModelFallback({
        provider: 'codex-cli',
        inputChars: 10,
        attempt: async (m) => m,
      })
    ).rejects.toThrow(/Cannot determine an available model/);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('rankCandidates tie-breaking', () => {
  it('prefers the provider\'s less prominent model when windows are equal', () => {
    // Otherwise a rejected first choice escalates straight to the flagship, which
    // is the most expensive model available.
    const sameWindow = [
      { slug: 'flagship', contextWindow: 272_000, priority: 1 },
      { slug: 'workhorse', contextWindow: 272_000, priority: 12 },
      { slug: 'balanced', contextWindow: 272_000, priority: 7 },
    ];
    expect(rankCandidates(discovery(sameWindow), 1_000)).toEqual([
      'workhorse',
      'balanced',
      'flagship',
    ]);
  });

  it('still puts a genuinely smaller model ahead of the tie-break group', () => {
    const mixed = [
      { slug: 'flagship', contextWindow: 272_000, priority: 1 },
      { slug: 'tiny', contextWindow: 128_000, priority: 26 },
    ];
    expect(rankCandidates(discovery(mixed), 1_000)[0]).toBe('tiny');
  });
});

describe('resolveReasoningEffort', () => {
  it('picks the weakest effort the model accepts', () => {
    const d = discovery([{ slug: 'm', reasoningLevels: ['high', 'low', 'medium'] }]);
    expect(resolveReasoningEffort(d, 'm')).toBe('low');
  });

  it('never returns an effort the model rejects', () => {
    // The real failure: a globally configured `max` is accepted only by the large
    // models, so inheriting it makes every small model unusable.
    const d = discovery([{ slug: 'small', reasoningLevels: ['low', 'medium', 'high', 'xhigh'] }]);
    expect(resolveReasoningEffort(d, 'small')).not.toBe('max');
  });

  it('defers to the provider default when no levels are published', () => {
    expect(resolveReasoningEffort(discovery([{ slug: 'm' }]), 'm')).toBeUndefined();
  });

  it('returns undefined for a model it does not know', () => {
    expect(resolveReasoningEffort(discovery([{ slug: 'm' }]), 'other')).toBeUndefined();
  });
});
