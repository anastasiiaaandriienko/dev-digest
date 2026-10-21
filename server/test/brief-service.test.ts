import { describe, it, expect, beforeEach, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { BlastRadius, LLMProvider, PrBrief, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';
import { ConfigError, ExternalServiceError, NotFoundError } from '../src/platform/errors.js';
import { BRIEF_INVALID_OUTPUT_MESSAGE, BRIEF_PROMPT_VERSION } from '../src/modules/brief/constants.js';
import { BriefInputsIncompleteError, BriefModelUnavailableError, BriefTimeoutError } from '../src/modules/brief/failures.js';
import { buildSaveBriefQuery, type BriefFile, type BriefPull, type BriefRow, type SaveBriefValues } from '../src/modules/brief/repository.js';
import { BriefService, type BriefStore } from '../src/modules/brief/service.js';

/**
 * Unit tests for BriefService. NO NETWORK and no database: the model is a
 * MockLLMProvider or a test-local fake, the store is in memory, blast is a stub
 * and feature-model resolution is mocked (AC-BRIEF-43).
 */

const h = vi.hoisted(() => ({
  model: { provider: 'openai', model: 'fake-model-a' } as { provider: string; model: string },
  resolve: vi.fn(),
}));
vi.mock('../src/modules/settings/feature-models.js', () => ({
  resolveFeatureModel: (...args: unknown[]) => {
    h.resolve(...args);
    return Promise.resolve(h.model);
  },
}));

const GOOD = {
  summary: 'Adds retry to the webhook sender.',
  risks: [{ kind: 'behavior', title: 'Retry storm', explanation: 'May hammer the endpoint.', severity: 'high', file_refs: ['src/a.ts:3'] }],
  review_focus: [
    { path: 'src/a.ts', line: 3, reason: 'retry loop' },
    { path: 'src/not-changed.ts', line: 1, reason: 'dropped' },
  ],
};

const BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: 'No changed symbols.', degraded: true, reason: 'no_data' };
const FILES: BriefFile[] = [{ path: 'src/a.ts', additions: 3, deletions: 1 }];

let seq = 0;
const newPrId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const pullOf = (id: string, headSha = 'sha1'): BriefPull => ({ id, title: 'Add retry', body: 'Body', headSha });

function briefOf(headSha: string, generatedAt: string): PrBrief {
  return {
    intent: { intent: '', in_scope: [], out_of_scope: [] },
    blast: BLAST,
    risks: { risks: [] },
    summary: 'previous summary',
    review_focus: [],
    meta: {
      head_sha: headSha, provider: 'openai', model: 'fake-model-a', prompt_version: BRIEF_PROMPT_VERSION,
      tokens_in: 1, tokens_out: 1, attempts: 1, cost_usd: 0, generated_at: generatedAt, truncated: false, intent_available: false,
    },
  };
}

class FakeStore implements BriefStore {
  row: BriefRow | undefined;
  saves: SaveBriefValues[] = [];
  /** When set, saveBrief reports "guard skipped" and leaves the row alone. */
  skipWrites = false;
  constructor(public pull: BriefPull | undefined, public files: BriefFile[] = FILES) {}
  async getPull() {
    return this.pull;
  }
  async listFiles() {
    return this.files;
  }
  async getBriefRow() {
    return this.row;
  }
  async saveBrief(v: SaveBriefValues) {
    this.saves.push(v);
    if (this.skipWrites) return false;
    this.row = { prId: v.prId, json: v.brief };
    return true;
  }
}

/** Test-local provider: scripted answer, optional failure and gate. */
class FakeLLM implements LLMProvider {
  readonly id = 'openai' as const;
  calls = 0;
  answer: unknown = GOOD;
  fail: Error | null = null;
  gate: Promise<void> | null = null;
  result: Partial<StructuredResult<unknown>> = {};
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
    if (this.gate) await this.gate;
    if (this.fail) throw this.fail;
    return { data: this.answer as T, model: 'x', tokensIn: 10, tokensOut: 5, costUsd: null, raw: '', attempts: 1, ...this.result } as StructuredResult<T>;
  }
}

function makeContainer(llm: () => Promise<LLMProvider>) {
  return {
    llm,
    priceBook: { estimate: () => 0.01 },
    tokenizer: { count: (t: string) => Math.ceil(t.length / 4) },
    reviewRepo: { getIntentRow: async () => undefined },
    get db(): never {
      throw new Error('container.db must not be used by the brief service in this test');
    },
  } as unknown as Container;
}

function setup(llm: LLMProvider = new FakeLLM(), prId = newPrId(), over: { timeoutMs?: number } = {}) {
  const store = new FakeStore(pullOf(prId));
  const service = new BriefService(makeContainer(async () => llm), {
    store,
    blast: { forPull: async () => BLAST },
    ...over,
  });
  return { store, service, prId, llm };
}

const mockLlm = () => new MockLLMProvider('openai', { structured: GOOD });

describe('BriefService', () => {
  beforeEach(() => {
    h.model = { provider: 'openai', model: 'fake-model-a' };
    h.resolve.mockClear();
  });

  it('AC-BRIEF-01 one completeStructured call', async () => {
    const llm = mockLlm();
    const { service, prId } = setup(llm);
    const state = await service.run('w1', prId);
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(llm.calls).toHaveLength(1);
    expect(state.brief?.summary).toBe(GOOD.summary);
    expect(state.freshness).toBe('fresh');
    // validation ran: the non-changed focus path was dropped
    expect(state.brief?.review_focus).toEqual([{ path: 'src/a.ts', line: 3, reason: 'retry loop' }]);
  });

  it('AC-BRIEF-02 resolves risk_brief model', async () => {
    h.model = { provider: 'openai', model: 'brief-model-x' };
    const llm = mockLlm();
    const { service, prId } = setup(llm);
    await service.run('w1', prId);
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), 'w1', 'risk_brief');
    const req = llm.calls[0]!.req as StructuredRequest<unknown>;
    expect(req.model).toBe('brief-model-x');
  });

  it('AC-BRIEF-50 passes maxTokens 2000 (temperature 0, maxRetries 1, no provider timeout)', async () => {
    const llm = mockLlm();
    const { service, prId } = setup(llm);
    await service.run('w1', prId);
    expect(llm.calls[0]!.req).toMatchObject({ maxTokens: 2000, temperature: 0, maxRetries: 1, timeoutMs: 0 });
  });

  it('AC-BRIEF-08 invalid output persists nothing', async () => {
    const llm = new FakeLLM();
    llm.answer = { summary: 5 };
    const { service, store, prId } = setup(llm);
    const err = await service.run('w1', prId).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.message).toBe(BRIEF_INVALID_OUTPUT_MESSAGE);
    expect(store.saves).toHaveLength(0);
    expect(store.row).toBeUndefined();
  });

  it('AC-BRIEF-21 LLM error keeps previous brief', async () => {
    const llm = new FakeLLM();
    llm.fail = Object.assign(new Error('secret provider text sk-123'), { status: 500 });
    const { service, store, prId } = setup(llm);
    const previous = briefOf('sha-old', '2026-01-01T00:00:00.000Z');
    store.row = { prId, json: previous };
    const err = await service.run('w1', prId).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.message).not.toContain('sk-123');
    expect(store.saves).toHaveLength(0);
    expect(store.row?.json).toEqual(previous);
    expect((await service.getState('w1', prId)).brief?.summary).toBe('previous summary');
  });

  it('AC-BRIEF-24 cost falls back to priceBook and tokens/attempts are stored as returned', async () => {
    const llm = new FakeLLM();
    llm.result = { tokensIn: 7000, tokensOut: 900, attempts: 2, costUsd: null };
    const { service, store, prId } = setup(llm);
    await service.run('w1', prId);
    const meta = store.saves[0]!.brief.meta!;
    expect(meta).toMatchObject({ cost_usd: 0.01, tokens_in: 7000, tokens_out: 900, attempts: 2, prompt_version: BRIEF_PROMPT_VERSION, head_sha: 'sha1' });
  });

  it('AC-BRIEF-24 a provider-reported cost wins over the price book', async () => {
    const llm = new FakeLLM();
    llm.result = { costUsd: 0.5 };
    const { service, store, prId } = setup(llm);
    await service.run('w1', prId);
    expect(store.saves[0]!.brief.meta!.cost_usd).toBe(0.5);
  });

  it('AC-BRIEF-45 504 then the flight still saves', async () => {
    const llm = new FakeLLM();
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const { service, store, prId } = setup(llm, undefined, { timeoutMs: 20 });
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(BriefTimeoutError);
    expect(store.saves).toHaveLength(0);
    release();
    await vi.waitFor(() => expect(store.saves).toHaveLength(1));
    expect(llm.calls).toBe(1);
    expect((await service.getState('w1', prId)).brief?.summary).toBe(GOOD.summary);
  });

  it('AC-BRIEF-19 concurrent runs share one call', async () => {
    const llm = new FakeLLM();
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const { service, prId } = setup(llm);
    const a = service.run('w1', prId);
    const b = service.run('w1', prId);
    await vi.waitFor(() => expect(llm.calls).toBe(1));
    release();
    await Promise.all([a, b]);
    expect(llm.calls).toBe(1);
  });

  it('AC-BRIEF-17 a fresh stored brief is a cache hit; force regenerates (AC-BRIEF-18)', async () => {
    const llm = new FakeLLM();
    const { service, prId } = setup(llm);
    await service.run('w1', prId);
    await service.run('w1', prId);
    expect(llm.calls).toBe(1);
    await service.run('w1', prId, { force: true });
    expect(llm.calls).toBe(2);
  });

  it('AC-BRIEF-13 a skipped write returns the stored state, not the discarded result', async () => {
    const llm = new FakeLLM();
    const { service, store, prId } = setup(llm);
    store.skipWrites = true;
    store.row = { prId, json: briefOf('sha1', '2099-01-01T00:00:00.000Z') };
    const state = await service.run('w1', prId, { force: true });
    expect(store.saves).toHaveLength(1);
    expect(state.brief?.summary).toBe('previous summary');
  });

  it('AC-BRIEF-13 generated_at is taken before inputs are read', async () => {
    const llm = new FakeLLM();
    const { service, store, prId } = setup(llm);
    const before = Date.now();
    await service.run('w1', prId);
    const at = Date.parse(store.saves[0]!.brief.meta!.generated_at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('AC-BRIEF-46 no stored files -> 409 and no LLM call', async () => {
    const llm = new FakeLLM();
    const { service, store, prId } = setup(llm);
    store.files = [];
    await expect(service.run('w1', prId)).rejects.toBeInstanceOf(BriefInputsIncompleteError);
    expect(llm.calls).toBe(0);
  });

  it('AC-BRIEF-20 no key -> 422 with no fallback and no LLM call, even with a fresh brief', async () => {
    const llm = new FakeLLM();
    const { store, prId } = setup(llm);
    const service = new BriefService(
      makeContainer(async () => {
        throw new ConfigError('OPENAI_API_KEY is not configured');
      }),
      { store, blast: { forPull: async () => BLAST } },
    );
    store.row = { prId, json: briefOf('sha1', '2026-01-01T00:00:00.000Z') };
    const err = await service.run('w1', prId).catch((e) => e);
    expect(err).toBeInstanceOf(BriefModelUnavailableError);
    expect(err.message).not.toContain('OPENAI_API_KEY');
    expect(llm.calls).toBe(0);
    const state = await service.getState('w1', prId);
    expect(state.model_error).toBeTruthy();
    expect(state.brief?.summary).toBe('previous summary');
  });

  it('AC-BRIEF-22 unknown / foreign PR -> 404 for getState and run', async () => {
    const store = new FakeStore(undefined);
    const service = new BriefService(makeContainer(async () => new FakeLLM()), { store, blast: { forPull: async () => BLAST } });
    await expect(service.getState('w1', newPrId())).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.run('w1', newPrId())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('saveBrief SQL', () => {
  // The builder is never executed: postgres-js connects lazily, so no database is touched.
  const db = drizzle(postgres('postgres://unused:unused@invalid.invalid:5432/unused'), { schema }) as unknown as Db;
  const { sql } = buildSaveBriefQuery(db, { prId: '11111111-1111-4111-8111-111111111111', brief: briefOf('sha1', '2026-01-01T00:00:00.000Z') }).toSQL();

  it('AC-BRIEF-13 is an upsert on pr_id', () => {
    expect(sql).toContain('insert into "pr_brief"');
    expect(sql).toContain('on conflict ("pr_id") do update set');
  });

  it('AC-BRIEF-13 guard part 1: incoming head must equal the current pull_requests.head_sha', () => {
    expect(sql).toContain(
      `(select "pull_requests"."head_sha" from "pull_requests" where "pull_requests"."id" = "pr_brief"."pr_id") = excluded."json"->'meta'->>'head_sha'`,
    );
  });

  it('AC-BRIEF-13 guard part 2: same-head generated_at ordering with IS NULL handling', () => {
    expect(sql).toContain(`"pr_brief"."json"->'meta' IS NULL`);
    expect(sql).toContain(`"pr_brief"."json"->'meta'->>'head_sha' IS DISTINCT FROM excluded."json"->'meta'->>'head_sha'`);
    expect(sql).toContain(`"pr_brief"."json"->'meta'->>'generated_at' IS NULL`);
    expect(sql).toContain(`"pr_brief"."json"->'meta'->>'generated_at' <= excluded."json"->'meta'->>'generated_at'`);
  });
});
