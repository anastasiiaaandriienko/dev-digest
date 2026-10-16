import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import type { Container } from '../src/platform/container.js';
import { TimeoutError, withTimeout } from '../src/platform/resilience.js';
import { IntentService, type IntentStore } from '../src/modules/reviews/intent/service.js';
import { IntentTimeoutError } from '../src/modules/reviews/intent/failures.js';
import { INTENT_PROVIDER_TIMEOUT_MS, INTENT_TIMEOUT_MS } from '../src/modules/reviews/intent/constants.js';
import type { IntentInputs, IntentRow, SaveIntentValues } from '../src/modules/reviews/repository/intent.repo.js';

// Single-flight vs. the provider-side timeout: the service must pass `timeoutMs: 0` so an
// adapter-style outer race cannot settle the flight while the SDK request keeps running.

const MODEL = { provider: 'openai', model: 'fake/model-a', source: 'fallback_onboarding' as const };
const GOOD = { intent: 'Adds retry', in_scope: ['retry'], out_of_scope: [], risk_areas: ['webhooks'], confidence: 'high' };
const ADAPTER_DEFAULT_TIMEOUT = 60_000; // openai.ts / anthropic.ts DEFAULT_TIMEOUT

let seq = 0;
const newPrId = () => `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;

function makeInputs(prId: string): IntentInputs {
  const files = [{ id: 'f1', prId, path: 'src/a.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@ fn\n+x' }];
  return {
    pull: {
      id: prId, workspaceId: 'w1', repoId: 'r1', number: 1, title: 'Add retry', author: 'u', branch: 'b', base: 'main',
      headSha: 'sha1', lastReviewedSha: null, additions: 1, deletions: 0, filesCount: 1, status: 'needs_review',
      body: 'Body v1', openedAt: null, updatedAt: null,
    },
    files,
    snapshotAt: new Date('2026-10-16T10:00:00Z'),
  };
}

class FakeStore implements IntentStore {
  row: IntentRow | undefined;
  saves: SaveIntentValues[] = [];
  constructor(private inputs: IntentInputs) {}
  async getIntentRow() {
    return this.row;
  }
  async getIntentInputs() {
    return this.inputs;
  }
  async saveIntent(v: SaveIntentValues) {
    this.saves.push(v);
    this.row = {
      prId: v.prId, intent: v.intent, inScope: v.inScope, outOfScope: v.outOfScope, riskAreas: v.riskAreas,
      confidence: v.confidence, inputFingerprint: v.inputFingerprint, promptVersion: v.promptVersion,
      provider: v.provider, model: v.model, headSha: v.headSha, inputSnapshotAt: v.inputSnapshotAt,
      generatedAt: new Date(), tokensIn: v.tokensIn, tokensOut: v.tokensOut, costUsd: v.costUsd,
    };
    return true;
  }
}

/**
 * Behaves like the OpenAI/Anthropic adapters: the SDK request is a controllable promise
 * and it is raced with `withTimeout(sdk, req.timeoutMs ?? 60_000)` WITHOUT cancelling it.
 */
class AdapterLikeLLM implements LLMProvider {
  readonly id = 'openai' as const;
  requests: StructuredRequest<unknown>[] = [];
  sdk: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  get calls() {
    return this.requests.length;
  }
  async listModels(): Promise<never> {
    throw new Error('not used');
  }
  async complete(): Promise<never> {
    throw new Error('not used');
  }
  async embed(): Promise<never> {
    throw new Error('not used');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const sdkCall = new Promise<unknown>((resolve, reject) => this.sdk.push({ resolve, reject }));
    const data = await withTimeout(sdkCall, req.timeoutMs ?? ADAPTER_DEFAULT_TIMEOUT);
    return { data: data as T, model: 'fake/model-a-2026', tokensIn: 10, tokensOut: 5, costUsd: null, raw: '', attempts: 1 };
  }
}

function setup() {
  const prId = newPrId();
  const llm = new AdapterLikeLLM();
  const store = new FakeStore(makeInputs(prId));
  const container = {
    llm: async () => llm,
    priceBook: { estimate: () => 0.01 },
    reviewRepo: store,
  } as unknown as Container;
  const service = new IntentService(container, { store, pickModel: async () => MODEL });
  return { prId, llm, store, service };
}

/** Lets pending microtasks (and zero-delay fake timers) run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('guard: withTimeout(p, 0) is a pass-through (the dependency intent relies on)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves only when p resolves - no TimeoutError however long it takes', async () => {
    let resolveP!: (v: string) => void;
    const p = new Promise<string>((r) => (resolveP = r));
    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    const guarded = withTimeout(p, 0).then(
      (v) => ((settled = 'resolved'), v),
      () => ((settled = 'rejected'), 'x'),
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000); // far past any adapter default
    expect(settled).toBe('pending');
    resolveP('late');
    await expect(guarded).resolves.toBe('late');
    expect(settled).toBe('resolved');
  });

  it('control: a positive timeout rejects with TimeoutError', async () => {
    const guarded = withTimeout(new Promise(() => {}), ADAPTER_DEFAULT_TIMEOUT).catch((e) => e);
    await vi.advanceTimersByTimeAsync(ADAPTER_DEFAULT_TIMEOUT);
    expect(await guarded).toBeInstanceOf(TimeoutError);
  });
});

describe('IntentService passes timeoutMs: 0 to the provider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('completeStructured receives timeoutMs 0 (INTENT_PROVIDER_TIMEOUT_MS), not the caller wait', async () => {
    const { prId, llm, service } = setup();
    const run = service.run('w1', prId);
    await flush();
    expect(llm.requests[0]!.timeoutMs).toBe(0);
    expect(INTENT_PROVIDER_TIMEOUT_MS).toBe(0);
    expect(INTENT_TIMEOUT_MS).toBeGreaterThan(0); // caller wait is unchanged
    llm.sdk[0]!.resolve(GOOD);
    await run;
  });
});

describe('single flight survives the caller timeout with an adapter-like provider (timeoutMs 0)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Starts a run and lets the caller wait (INTENT_TIMEOUT_MS) elapse -> returns the 504. */
  async function firstRunTimesOut(ctx: ReturnType<typeof setup>) {
    const first = ctx.service.run('w1', ctx.prId).catch((e) => e);
    await vi.advanceTimersByTimeAsync(INTENT_TIMEOUT_MS + 1_000); // also past the adapter's 60s default
    return first;
  }

  it('(a) caller wait times out -> 504 intent_timeout, LLM called once, flight still registered', async () => {
    const ctx = setup();
    const err = await firstRunTimesOut(ctx);
    expect(err).toBeInstanceOf(IntentTimeoutError);
    expect(err).toMatchObject({ statusCode: 504, code: 'intent_timeout' });
    expect(ctx.llm.calls).toBe(1);
    expect(ctx.store.saves).toHaveLength(0);

    // "still registered": an identical request joins instead of calling again
    const joined = ctx.service.run('w1', ctx.prId).catch((e) => e);
    await flush();
    expect(ctx.llm.calls).toBe(1);

    ctx.llm.sdk[0]!.resolve(GOOD); // cleanup
    await joined;
  });

  it('(b) identical retry and force retry after the 504 join the running flight -> LLM calls stay 1', async () => {
    const ctx = setup();
    expect(await firstRunTimesOut(ctx)).toBeInstanceOf(IntentTimeoutError);

    const retry = ctx.service.run('w1', ctx.prId);
    const forced = ctx.service.run('w1', ctx.prId, { force: true });
    await flush();
    expect(ctx.llm.calls).toBe(1);
    expect(ctx.llm.sdk).toHaveLength(1);

    ctx.llm.sdk[0]!.resolve(GOOD); // the original SDK request finally ends inside the joiners' wait
    const [r1, r2] = await Promise.all([retry, forced]);
    expect(ctx.llm.calls).toBe(1);
    expect(r1).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(r2).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(ctx.store.saves).toHaveLength(1);
  });

  it('(c) SDK call resolves late -> saved once, entry cleared, next request is a cache hit (0 new calls)', async () => {
    const ctx = setup();
    expect(await firstRunTimesOut(ctx)).toBeInstanceOf(IntentTimeoutError);

    ctx.llm.sdk[0]!.resolve(GOOD);
    await flush();
    expect(ctx.store.saves).toHaveLength(1);

    const hit = await ctx.service.run('w1', ctx.prId);
    expect(hit).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(ctx.llm.calls).toBe(1);

    // entry cleared: a force request starts a NEW flight (would join with computed:false if it were still registered)
    const forced = ctx.service.run('w1', ctx.prId, { force: true });
    await flush();
    expect(ctx.llm.calls).toBe(2);
    ctx.llm.sdk[1]!.resolve(GOOD);
    expect(await forced).toMatchObject({ computed: true });
    expect(ctx.store.saves).toHaveLength(2);
  });

  it('(d) SDK call rejects late -> nothing saved, entry cleared, next request starts exactly one new call', async () => {
    const ctx = setup();
    expect(await firstRunTimesOut(ctx)).toBeInstanceOf(IntentTimeoutError);

    ctx.llm.sdk[0]!.reject(new Error('late provider failure'));
    await flush();
    expect(ctx.store.saves).toHaveLength(0);
    expect(ctx.llm.calls).toBe(1);

    const next = ctx.service.run('w1', ctx.prId);
    await flush();
    expect(ctx.llm.calls).toBe(2);
    ctx.llm.sdk[1]!.resolve(GOOD);
    expect(await next).toMatchObject({ computed: true, freshness: 'fresh' });
    expect(ctx.llm.calls).toBe(2);
    expect(ctx.store.saves).toHaveLength(1);
  });
});
