import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import { AppError, ExternalServiceError, NotFoundError } from '../src/platform/errors.js';
import { IntentService, type IntentStore } from '../src/modules/reviews/intent/service.js';
import { IntentModelUnavailableError } from '../src/modules/reviews/intent/model.js';
import { IntentInputsIncompleteError, IntentInvalidOutputError, IntentTimeoutError, mapIntentFailure } from '../src/modules/reviews/intent/failures.js';
import { INTENT_TIMEOUT_MESSAGE } from '../src/modules/reviews/intent/constants.js';
import { INTENT_PROMPT_VERSION } from '../src/modules/reviews/intent/constants.js';
import { computeFingerprint } from '../src/modules/reviews/intent/fingerprint.js';
import type { IntentInputs, IntentRow, SaveIntentValues } from '../src/modules/reviews/repository/intent.repo.js';
import reviewsRoutes from '../src/modules/reviews/routes.js';

// ---- fakes ------------------------------------------------------------------

const MODEL = { provider: 'openrouter', model: 'fake/model-a', source: 'fallback_onboarding' as const };
const GOOD = { intent: 'Adds retry', in_scope: ['retry'], out_of_scope: [], risk_areas: ['webhooks'], confidence: 'high' };

let seq = 0;
const newPrId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function makeInputs(prId: string, over: { body?: string; headSha?: string; filesCount?: number; files?: boolean; at?: Date } = {}): IntentInputs {
  const files = over.files === false ? [] : [{ id: 'f1', prId, path: 'src/a.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@ fn\n+x' }];
  return {
    pull: {
      id: prId, workspaceId: 'w1', repoId: 'r1', number: 1, title: 'Add retry', author: 'u', branch: 'b', base: 'main',
      headSha: over.headSha ?? 'sha1', lastReviewedSha: null, additions: 1, deletions: 0,
      filesCount: over.filesCount ?? files.length, status: 'needs_review', body: over.body ?? 'Body v1', openedAt: null, updatedAt: null,
    },
    files,
    snapshotAt: over.at ?? new Date('2026-10-16T10:00:00Z'),
  };
}

/** In-memory store honouring the same snapshot condition as the SQL upsert. No transaction API at all. */
class FakeStore implements IntentStore {
  row: IntentRow | undefined;
  inputs: IntentInputs | undefined;
  saves: SaveIntentValues[] = [];
  events: string[] = [];
  constructor(inputs?: IntentInputs) {
    this.inputs = inputs;
  }
  async getIntentRow() {
    return this.row;
  }
  async getIntentInputs() {
    return this.inputs;
  }
  async saveIntent(v: SaveIntentValues) {
    this.events.push('save');
    this.saves.push(v);
    if (this.row?.inputSnapshotAt && this.row.inputSnapshotAt > v.inputSnapshotAt) return false;
    this.row = {
      prId: v.prId, intent: v.intent, inScope: v.inScope, outOfScope: v.outOfScope, riskAreas: v.riskAreas,
      confidence: v.confidence, inputFingerprint: v.inputFingerprint, promptVersion: v.promptVersion,
      provider: v.provider, model: v.model, headSha: v.headSha, inputSnapshotAt: v.inputSnapshotAt,
      generatedAt: new Date(), tokensIn: v.tokensIn, tokensOut: v.tokensOut, costUsd: v.costUsd,
    };
    return true;
  }
}

class FakeLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  calls = 0;
  answer: unknown = GOOD;
  fail: Error | null = null;
  gate: Promise<void> | null = null;
  onCall: (() => void) | null = null;
  events: string[] | null = null;
  async listModels() {
    throw new Error('listModels must not be called');
  }
  async complete(): Promise<never> {
    throw new Error('complete must not be called');
  }
  async embed(): Promise<never> {
    throw new Error('embed must not be called');
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    this.events?.push('llm:start');
    this.onCall?.();
    if (this.gate) await this.gate;
    if (this.fail) throw this.fail;
    this.events?.push('llm:end');
    return { data: this.answer as T, model: 'fake/model-a-2026', tokensIn: 10, tokensOut: 5, costUsd: null, raw: '', attempts: 1 };
  }
}

/** Container with only what the intent service may touch; DB / jobs access would throw (no transactions possible). */
function makeContainer(llm: FakeLLM, store: IntentStore) {
  return {
    llm: async () => llm,
    priceBook: { estimate: () => 0.01 },
    reviewRepo: store,
    auth: new MockAuthProvider(),
    get db(): never {
      throw new Error('container.db must not be used by the intent flow in this test');
    },
    get jobs(): never {
      throw new Error('container.jobs must not be used');
    },
  } as unknown as Container;
}

function setup(inputs = makeInputs('x'), pickModel = async () => MODEL) {
  const llm = new FakeLLM();
  const store = new FakeStore(inputs);
  const service = new IntentService(makeContainer(llm, store), { store, pickModel });
  return { llm, store, service };
}

// ---- tests --------------------------------------------------------------------

describe('IntentService', () => {
  let prId: string;
  beforeEach(() => {
    prId = newPrId();
  });

  it('getState makes 0 LLM calls (no row: unknown, intent null, model reported)', async () => {
    const { llm, service } = setup(makeInputs(prId));
    const s = await service.getState('w1', prId);
    expect(llm.calls).toBe(0);
    expect(s).toMatchObject({ pr_id: prId, intent: null, meta: null, freshness: 'unknown', stale_reasons: [], current_model: MODEL });
  });

  it('unknown / foreign PR -> 404 for both getState and run', async () => {
    const store = new FakeStore(undefined);
    const service = new IntentService(makeContainer(new FakeLLM(), store), { store, pickModel: async () => MODEL });
    await expect(service.getState('w1', prId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('miss -> exactly 1 call + 1 save; second run is a cache hit with 0 calls', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    const first = await service.run('w1', prId);
    expect(llm.calls).toBe(1);
    expect(store.saves).toHaveLength(1);
    expect(first).toMatchObject({ computed: true, freshness: 'fresh', stale_reasons: [] });
    expect(first.intent).toEqual({ intent: 'Adds retry', in_scope: ['retry'], out_of_scope: [], risk_areas: ['webhooks'] });
    expect(first.meta).toMatchObject({ provider: 'openrouter', model: 'fake/model-a', prompt_version: INTENT_PROMPT_VERSION, confidence: 'high', tokens_in: 10, tokens_out: 5 });

    const second = await service.run('w1', prId);
    expect(llm.calls).toBe(1);
    expect(store.saves).toHaveLength(1);
    expect(second).toMatchObject({ computed: false, freshness: 'fresh' });
  });

  it('stores the requested model id (not the provider-resolved one) so it stays fresh', async () => {
    const { store, service } = setup(makeInputs(prId));
    await service.run('w1', prId);
    expect(store.saves[0]!.model).toBe('fake/model-a');
  });

  it('force -> one more call and save', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    await service.run('w1', prId);
    const forced = await service.run('w1', prId, { force: true });
    expect(llm.calls).toBe(2);
    expect(store.saves).toHaveLength(2);
    expect(forced.computed).toBe(true);
  });

  it('two concurrent identical runs share ONE call (join)', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const a = service.run('w1', prId);
    const b = service.run('w1', prId);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(llm.calls).toBe(1);
    expect(store.saves).toHaveLength(1);
    expect([ra.computed, rb.computed].sort()).toEqual([false, true]);
    expect(ra.freshness).toBe('fresh');
    expect(rb.freshness).toBe('fresh');
  });

  it('concurrent runs join even when force=true', async () => {
    const { llm, service } = setup(makeInputs(prId));
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const a = service.run('w1', prId, { force: true });
    const b = service.run('w1', prId, { force: true });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([a, b]);
    expect(llm.calls).toBe(1);
  });

  describe('cache read vs. flight settling (check-then-create race)', () => {
    /** Store whose FIRST getIntentRow is paused after reading (returns the pre-save snapshot when released). */
    function gatedFirstRead(prId: string) {
      const llm = new FakeLLM();
      const store = new FakeStore(makeInputs(prId));
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const readEntered = new Promise<void>((r) => (entered = r));
      let reads = 0;
      const realRead = store.getIntentRow.bind(store);
      store.getIntentRow = async () => {
        reads += 1;
        const snapshot = await realRead(); // value as of NOW (before any save)
        if (reads === 1) {
          entered();
          await gate;
          return snapshot; // stale: the flight saves while we are paused
        }
        return realRead();
      };
      const service = new IntentService(makeContainer(llm, store), { store, pickModel: async () => MODEL });
      return { llm, store, service, release, readEntered, reads: () => reads };
    }

    it('flight completes + saves while a second request is inside its cache read -> 1 LLM call, second is computed:false with the saved intent', async () => {
      const prId = newPrId();
      const { llm, store, service, release, readEntered } = gatedFirstRead(prId);

      const second = service.run('w1', prId); // paused in its (stale) cache read
      await readEntered;

      const first = await service.run('w1', prId); // full flight: call, save, finally (entry deleted)
      expect(first.computed).toBe(true);
      expect(store.saves).toHaveLength(1);

      release();
      const result = await second;
      expect(llm.calls).toBe(1);
      expect(store.saves).toHaveLength(1);
      expect(result).toMatchObject({ computed: false, freshness: 'fresh' });
      expect(result.intent?.intent).toBe('Adds retry');
    });

    it('force=true skips the cache check and still calls; a paused non-force request then reuses the forced result', async () => {
      const prId = newPrId();
      const { llm, store, service, release, readEntered, reads } = gatedFirstRead(prId);

      const paused = service.run('w1', prId); // non-force, paused in cache read
      await readEntered;
      expect(reads()).toBe(1);

      // force does not consult the cache (only the final getState read happens), so it calls the model
      const forced = await service.run('w1', prId, { force: true });
      expect(reads()).toBe(2);
      expect(forced.computed).toBe(true);
      expect(llm.calls).toBe(1);

      release();
      const result = await paused;
      expect(result.computed).toBe(false); // re-check found the fresh row
      expect(llm.calls).toBe(1);
      expect(store.saves).toHaveLength(1);

      // force after the flight settled is never suppressed by the cache
      const forcedAgain = await service.run('w1', prId, { force: true });
      expect(forcedAgain.computed).toBe(true);
      expect(llm.calls).toBe(2);
    });
  });

  it('a different model is a different key -> 2 calls', async () => {
    const inputs = makeInputs(prId);
    const llm = new FakeLLM();
    const store = new FakeStore(inputs);
    const container = makeContainer(llm, store);
    const a = new IntentService(container, { store, pickModel: async () => MODEL });
    const b = new IntentService(container, { store, pickModel: async () => ({ ...MODEL, model: 'fake/model-b' }) });
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const pa = a.run('w1', prId);
    const pb = b.run('w1', prId);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([pa, pb]);
    expect(llm.calls).toBe(2);
  });

  it('LLM error -> ExternalServiceError, nothing saved, old intent kept', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    await service.run('w1', prId);
    const before = store.row;
    llm.fail = new Error('boom');
    await expect(service.run('w1', prId, { force: true })).rejects.toBeInstanceOf(ExternalServiceError);
    expect(store.saves).toHaveLength(1);
    expect(store.row).toBe(before);
    // a failed flight does not stay registered: the next attempt runs again
    llm.fail = null;
    await service.run('w1', prId, { force: true });
    expect(store.saves).toHaveLength(2);
  });

  it('invalid model output -> ExternalServiceError, nothing saved', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    llm.answer = { intent: 42 };
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(ExternalServiceError);
    expect(store.saves).toHaveLength(0);
    expect(store.row).toBeUndefined();
  });

  it('model unavailable -> IntentModelUnavailableError (422), 0 calls; getState reports it instead of throwing', async () => {
    const unavailable = async () => {
      throw new IntentModelUnavailableError('pick one in Settings > Models > PR Review · Intent');
    };
    const { llm, service } = setup(makeInputs(prId), unavailable);
    const err = await service.run('w1', prId).catch((e) => e);
    expect(err).toBeInstanceOf(IntentModelUnavailableError);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('intent_model_unavailable');
    expect(llm.calls).toBe(0);
    const s = await service.getState('w1', prId);
    expect(s.current_model).toBeNull();
    expect(s.model_error).toContain('Settings > Models');
  });

  it('PR body edited DURING the call -> saved with the OLD fingerprint, reported stale (pr_changed)', async () => {
    const v1 = makeInputs(prId, { body: 'Body v1' });
    const v2 = makeInputs(prId, { body: 'Body v2 (edited while the model ran)', at: new Date('2026-10-16T10:00:05Z') });
    const { llm, store, service } = setup(v1);
    llm.onCall = () => {
      store.inputs = v2; // the post-call read sees the edited PR
    };
    const result = await service.run('w1', prId);
    const oldFp = computeFingerprint({ title: 'Add retry', body: 'Body v1', headSha: 'sha1', base: 'main', files: [{ path: 'src/a.ts', additions: 1, deletions: 0, patch: '@@ -1 +1 @@ fn\n+x' }] });
    expect(store.saves[0]!.inputFingerprint).toBe(oldFp);
    expect(store.saves[0]!.inputSnapshotAt).toEqual(v1.snapshotAt);
    expect(result.freshness).toBe('stale');
    expect(result.stale_reasons).toEqual(['pr_changed']);
    expect(result.computed).toBe(true);
  });

  it('head_sha moved during the call -> stale with pr_changed too', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    llm.onCall = () => {
      store.inputs = makeInputs(prId, { headSha: 'sha2' });
    };
    expect((await service.run('w1', prId)).stale_reasons).toEqual(['pr_changed']);
  });

  it('an older snapshot arriving after a newer one does not overwrite it; the newer state is returned', async () => {
    const newer = makeInputs(prId, { body: 'Body v2', at: new Date('2026-10-16T10:00:10Z') });
    const older = makeInputs(prId, { body: 'Body v1', at: new Date('2026-10-16T10:00:00Z') });
    const { llm, store, service } = setup(newer);
    await service.run('w1', prId); // newer snapshot saved
    const kept = store.row!;
    llm.answer = { ...GOOD, intent: 'OLD RESULT' };
    store.inputs = older; // a slower computation that read an older snapshot
    await service.run('w1', prId, { force: true });
    expect(store.saves).toHaveLength(2); // attempted…
    expect(store.row).toBe(kept); // …but refused
    expect(store.row!.intent).toBe('Adds retry');
  });

  it('stale_reasons: pr_changed / model_changed / prompt_changed', async () => {
    const { store, service } = setup(makeInputs(prId));
    await service.run('w1', prId);
    const row = store.row!;

    store.row = { ...row, inputFingerprint: 'other' };
    expect((await service.getState('w1', prId)).stale_reasons).toEqual(['pr_changed']);

    store.row = { ...row, model: 'fake/model-old' };
    expect((await service.getState('w1', prId)).stale_reasons).toEqual(['model_changed']);

    store.row = { ...row, promptVersion: 'intent-v0' };
    expect((await service.getState('w1', prId)).stale_reasons).toEqual(['prompt_changed']);

    store.row = { ...row, inputFingerprint: null, promptVersion: null, provider: null, model: null }; // legacy row
    const legacy = await service.getState('w1', prId);
    expect(legacy.freshness).toBe('stale');
    expect(legacy.stale_reasons).toEqual(['pr_changed', 'prompt_changed', 'model_changed']);
    expect(legacy.meta).toMatchObject({ provider: null, prompt_version: null });
  });

  it('files missing locally -> GET unknown; head moved while files are still missing -> pr_changed', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    await service.run('w1', prId);
    store.inputs = makeInputs(prId, { files: false, filesCount: 3 });
    expect((await service.getState('w1', prId)).freshness).toBe('unknown');
    store.inputs = makeInputs(prId, { files: false, filesCount: 3, headSha: 'sha2' });
    expect((await service.getState('w1', prId)).stale_reasons).toEqual(['pr_changed']);
    expect(llm.calls).toBe(1);
  });

  describe('unknown file list (PR sync window): the LLM is never called', () => {
    it('stored fresh intent + pr_files temporarily empty (filesCount>0) -> POST returns stored as unknown, 0 calls; files reappear -> fresh, no call', async () => {
      const { llm, store, service } = setup(makeInputs(prId));
      await service.run('w1', prId);
      expect(llm.calls).toBe(1);

      store.inputs = makeInputs(prId, { files: false, filesCount: 3 });
      const during = await service.run('w1', prId);
      expect(during).toMatchObject({ computed: false, freshness: 'unknown', stale_reasons: [] });
      expect(during.intent).not.toBeNull();
      expect(llm.calls).toBe(1);

      store.inputs = makeInputs(prId);
      const after = await service.run('w1', prId);
      expect(after).toMatchObject({ computed: false, freshness: 'fresh' });
      expect(llm.calls).toBe(1);
      expect(store.saves).toHaveLength(1);
    });

    it('force does NOT bypass the guard: 409 intent_inputs_incomplete, 0 calls', async () => {
      const { llm, store, service } = setup(makeInputs(prId));
      await service.run('w1', prId);
      store.inputs = makeInputs(prId, { files: false, filesCount: 3 });
      const err = await service.run('w1', prId, { force: true }).catch((e) => e);
      expect(err).toBeInstanceOf(IntentInputsIncompleteError);
      expect(err).toMatchObject({ statusCode: 409, code: 'intent_inputs_incomplete' });
      expect(llm.calls).toBe(1);
    });

    it('no stored intent + empty files -> 409, 0 calls, nothing saved (also the imported-but-not-opened PR: filesCount 0)', async () => {
      for (const filesCount of [3, 0]) {
        const { llm, store, service } = setup(makeInputs(prId, { files: false, filesCount }));
        await expect(service.run('w1', prId)).rejects.toMatchObject({ statusCode: 409, code: 'intent_inputs_incomplete' });
        await expect(service.run('w1', prId, { force: true })).rejects.toMatchObject({ statusCode: 409 });
        expect(llm.calls).toBe(0);
        expect(store.saves).toHaveLength(0);
      }
    });

    it('stored intent for a DIFFERENT head + empty files -> 409, 0 calls', async () => {
      const { llm, store, service } = setup(makeInputs(prId));
      await service.run('w1', prId);
      store.inputs = makeInputs(prId, { files: false, filesCount: 3, headSha: 'sha2' });
      await expect(service.run('w1', prId)).rejects.toBeInstanceOf(IntentInputsIncompleteError);
      expect(llm.calls).toBe(1);
    });

    it('resolveForRun: stored intent with the same head is returned (unknown); otherwise null; never computes', async () => {
      const { llm, store, service } = setup(makeInputs(prId, { files: false, filesCount: 3 }));
      expect(await service.resolveForRun('w1', prId)).toBeNull(); // no stored intent
      expect(llm.calls).toBe(0);

      store.inputs = makeInputs(prId);
      await service.run('w1', prId);
      store.inputs = makeInputs(prId, { files: false, filesCount: 3 });
      const state = await service.resolveForRun('w1', prId);
      expect(state).toMatchObject({ freshness: 'unknown' });
      expect(state?.intent).not.toBeNull();

      store.inputs = makeInputs(prId, { files: false, filesCount: 3, headSha: 'sha2' });
      expect(await service.resolveForRun('w1', prId)).toBeNull();
      expect(llm.calls).toBe(1);
    });
  });

  it('LLM is called before the save, and the flow never touches container.db / jobs (no transaction)', async () => {
    const { llm, store, service } = setup(makeInputs(prId));
    store.events = [];
    llm.events = store.events;
    await service.run('w1', prId); // would throw if container.db / container.jobs were read
    expect(store.events).toEqual(['llm:start', 'llm:end', 'save']);
    expect('transaction' in store).toBe(false);
  });

  it('resolveForRun never throws: null when no model, stored fresh intent otherwise', async () => {
    const unavailable = async () => {
      throw new IntentModelUnavailableError('no model');
    };
    const none = setup(makeInputs(prId), unavailable);
    expect(await none.service.resolveForRun('w1', prId)).toBeNull();

    const ok = setup(makeInputs(prId));
    const state = await ok.service.resolveForRun('w1', prId); // computes
    expect(state?.intent?.intent).toBe('Adds retry');
    await ok.service.resolveForRun('w1', prId); // reuses
    expect(ok.llm.calls).toBe(1);

    ok.llm.fail = new Error('down');
    ok.store.row = { ...ok.store.row!, inputFingerprint: 'stale-now' };
    expect(await ok.service.resolveForRun('w1', prId)).toBeNull(); // stale + failing recompute -> null, no throw
  });
});

// ---- single flight vs. HTTP timeout (W1) ---------------------------------------------

describe('IntentService: caller timeout does not abandon the paid call', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  function timed(prId: string, timeoutMs = 30) {
    const llm = new FakeLLM();
    const store = new FakeStore(makeInputs(prId));
    const service = new IntentService(makeContainer(llm, store), { store, pickModel: async () => MODEL, timeoutMs });
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    return { llm, store, service, release: () => release() };
  }

  it('(a) caller times out -> safe 504 intent_timeout; the LLM was still called exactly once', async () => {
    const prId = newPrId();
    const { llm, store, service, release } = timed(prId);
    const err = await service.run('w1', prId).catch((e) => e);
    expect(err).toBeInstanceOf(IntentTimeoutError);
    expect(err).toMatchObject({ statusCode: 504, code: 'intent_timeout', message: INTENT_TIMEOUT_MESSAGE });
    expect(llm.calls).toBe(1);
    expect(store.saves).toHaveLength(0); // nothing returned or saved yet
    release();
    await sleep(10);
  });

  it('(b) an identical request while the flight is still running joins it (also with force) -> LLM calls stay 1', async () => {
    const prId = newPrId();
    const { llm, service, release } = timed(prId);
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(IntentTimeoutError);

    const joinedForce = service.run('w1', prId, { force: true });
    const joined = service.run('w1', prId);
    await sleep(5);
    release(); // the original flight completes inside the joiners' wait
    const [rf, rj] = await Promise.all([joinedForce, joined]);
    expect(llm.calls).toBe(1);
    expect(rf).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(rj).toMatchObject({ computed: false, freshness: 'fresh' });
  });

  it('(c) after the flight completes the late result is stored and the next request is a cache hit (0 new calls)', async () => {
    const prId = newPrId();
    const { llm, store, service, release } = timed(prId);
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(IntentTimeoutError);
    release();
    await sleep(10);
    expect(store.saves).toHaveLength(1);
    expect((await service.getState('w1', prId)).freshness).toBe('fresh'); // visible via GET
    const third = await service.run('w1', prId);
    expect(third).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(llm.calls).toBe(1);
  });

  it('(d) flight fails after the caller timed out -> nothing saved, entry cleared, next request starts a new call', async () => {
    const prId = newPrId();
    const { llm, store, service, release } = timed(prId);
    llm.fail = new Error('late failure');
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(IntentTimeoutError);
    release();
    await sleep(10);
    expect(store.saves).toHaveLength(0);
    expect(llm.calls).toBe(1);

    llm.fail = null;
    llm.gate = null;
    const next = await service.run('w1', prId);
    expect(llm.calls).toBe(2);
    expect(next).toMatchObject({ computed: true, freshness: 'fresh' });
  });
});

// ---- safe errors (S1) ---------------------------------------------------------------

const SECRETS = ['sk-or-v1-SECRET123', 'TOKEN456', 'Bearer', 'Authorization', 'No auth credentials found', 'raw-body-marker'];

class ProviderHttpError extends Error {
  constructor(public status: number) {
    super(
      `${status} {"error":{"message":"No auth credentials found","raw":"raw-body-marker"}} ` +
        'key=sk-or-v1-SECRET123 Authorization: Bearer TOKEN456',
    );
    this.name = 'APIError';
  }
}

describe('mapIntentFailure: status/code mapping and safe fields', () => {
  const MSG = {
    auth: 'The model provider rejected the API key — check Settings > API keys.',
    rate: 'The model provider rate-limited the request — try again later.',
    invalid: 'The model returned an invalid intent — try again or choose another model.',
    generic: 'The model provider returned an error.',
  };
  const cases: Array<[string, unknown, number, string, string]> = [
    ['HTTP 401', new ProviderHttpError(401), 502, 'external_service_error', MSG.auth],
    ['HTTP 403', new ProviderHttpError(403), 502, 'external_service_error', MSG.auth],
    ['HTTP 429', new ProviderHttpError(429), 502, 'external_service_error', MSG.rate],
    ['HTTP 500', new ProviderHttpError(500), 502, 'external_service_error', MSG.generic],
    ['invalid model output', new IntentInvalidOutputError(), 502, 'external_service_error', MSG.invalid],
    ['adapter schema failure', new ExternalServiceError('OpenAI structured output failed schema validation', { raw: 'x' }), 502, 'external_service_error', MSG.invalid],
    ['SyntaxError', new SyntaxError('Unexpected token sk-or-v1-SECRET123'), 502, 'external_service_error', MSG.invalid],
    ['generic Error', new Error('boom sk-or-v1-SECRET123'), 502, 'external_service_error', MSG.generic],
    ['provider timeout', Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }), 504, 'intent_timeout', INTENT_TIMEOUT_MESSAGE],
    ['non-Error string rejection', 'Authorization: Bearer TOKEN456', 502, 'external_service_error', MSG.generic],
    ['non-Error undefined rejection', undefined, 502, 'external_service_error', MSG.generic],
  ];
  it.each(cases)('%s', (_name, err, status, code, message) => {
    const { error, fields } = mapIntentFailure(err);
    expect(error).toMatchObject({ statusCode: status, code, message });
    for (const s of SECRETS) expect(JSON.stringify({ error: error.message, fields })).not.toContain(s);
  });

  it('records safe fields only (name, http status, short code) — never the message', () => {
    const { fields } = mapIntentFailure(Object.assign(new ProviderHttpError(401), { code: 'invalid_api_key' }));
    expect(fields).toEqual({ errorName: 'APIError', httpStatus: 401, providerCode: 'invalid_api_key' });
    // a code that is not a short token is dropped
    expect(mapIntentFailure(Object.assign(new Error('x'), { code: 'has spaces and sk-or-v1-SECRET123' })).fields.providerCode).toBeUndefined();
  });

  it('our own intent_* errors pass through unchanged', () => {
    const own = new IntentInputsIncompleteError();
    expect(mapIntentFailure(own).error).toBe(own);
  });
});

// ---- routes ---------------------------------------------------------------------

describe('intent routes', () => {
  async function appWith(prId: string, logLines?: string[]) {
    const llm = new FakeLLM();
    const store = new FakeStore(makeInputs(prId));
    // IntentService (built by the plugin) resolves the model through container.db settings + container.llm.
    const emptySettingsDb = { select: () => ({ from: () => ({ where: async () => [] }) }) };
    const container = {
      llm: async () => llm,
      priceBook: { estimate: () => 0.01 },
      reviewRepo: store,
      auth: new MockAuthProvider(),
      db: emptySettingsDb,
    } as unknown as Container;
    const app = Fastify(
      logLines ? { logger: { level: 'info', stream: { write: (line: string) => void logLines.push(line) } } } : {},
    );
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Mirrors the AppError branch of the real handler (src/app.ts); other errors keep their own status.
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) {
        reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
        return;
      }
      reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { code: 'internal_error', message: 'Internal error' } });
    });
    app.decorate('container', container);
    await app.register(reviewsRoutes);
    return { app, llm, store };
  }

  it('provider failure: HTTP body and server logs carry no key, header, token or raw body; status/code are mapped', async () => {
    const id = newPrId();
    const logs: string[] = [];
    const { app, llm } = await appWith(id, logs);

    const attempts: Array<[() => void, number, string, string]> = [
      [() => (llm.fail = new ProviderHttpError(401)), 502, 'external_service_error', 'The model provider rejected the API key — check Settings > API keys.'],
      [() => (llm.fail = new ProviderHttpError(429)), 502, 'external_service_error', 'The model provider rate-limited the request — try again later.'],
      [() => (llm.fail = new Error('{"error":{"message":"No auth credentials found","raw":"raw-body-marker"}} sk-or-v1-SECRET123 Authorization: Bearer TOKEN456')), 502, 'external_service_error', 'The model provider returned an error.'],
      [() => (llm.fail = 'Authorization: Bearer TOKEN456 sk-or-v1-SECRET123' as unknown as Error), 502, 'external_service_error', 'The model provider returned an error.'],
      [() => { llm.fail = null; llm.answer = { intent: 42 }; }, 502, 'external_service_error', 'The model returned an invalid intent — try again or choose another model.'],
    ];
    for (const [arm, status, code, message] of attempts) {
      arm();
      const res = await app.inject({ method: 'POST', url: `/pulls/${id}/intent`, payload: { force: true } });
      expect(res.statusCode).toBe(status);
      expect(res.json().error).toMatchObject({ code, message });
      for (const s of SECRETS) expect(res.body).not.toContain(s);
    }

    const allLogs = logs.join('\n');
    for (const s of SECRETS) expect(allLogs).not.toContain(s);
    const failed = logs.map((l) => JSON.parse(l)).filter((l) => l.msg === 'intent: generation failed');
    expect(failed).toHaveLength(attempts.length);
    expect(failed[0]).toMatchObject({ prId: id, provider: 'openrouter', model: expect.any(String), errorCode: 'external_service_error', httpStatus: 401, errorName: 'APIError' });
    await app.close();
  });

  it('GET /pulls/:id/intent never calls the LLM', async () => {
    const id = newPrId();
    const { app, llm } = await appWith(id);
    const res = await app.inject({ method: 'GET', url: `/pulls/${id}/intent` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pr_id: id, intent: null, freshness: 'unknown' });
    expect(llm.calls).toBe(0);
    await app.close();
  });

  it('POST with no body / {} means force=false (second call is a cache hit); {force:true} calls again', async () => {
    const id = newPrId();
    const { app, llm } = await appWith(id);
    const first = await app.inject({ method: 'POST', url: `/pulls/${id}/intent` });
    expect(first.statusCode).toBe(200);
    expect(first.json().computed).toBe(true);
    const second = await app.inject({ method: 'POST', url: `/pulls/${id}/intent`, payload: {} });
    expect(second.json().computed).toBe(false);
    expect(llm.calls).toBe(1);
    const forced = await app.inject({ method: 'POST', url: `/pulls/${id}/intent`, payload: { force: true } });
    expect(forced.json().computed).toBe(true);
    expect(llm.calls).toBe(2);
    await app.close();
  });

  it('rejects a non-uuid id with 400/422 before reaching the service', async () => {
    const { app, llm } = await appWith(newPrId());
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' });
    expect([400, 422]).toContain(res.statusCode);
    expect(llm.calls).toBe(0);
    await app.close();
  });
});
