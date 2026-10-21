import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PrBrief, type LLMProvider, type StructuredRequest, type StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { buildSeedBrief, SEED_BRIEF_SUMMARY } from '../src/db/seed-brief.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { BRIEF_MODEL_UNAVAILABLE_MESSAGE, BRIEF_PROMPT_VERSION } from '../src/modules/brief/constants.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { SCHEMA_NAME } from '../src/modules/brief/prompt.js';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

/**
 * PR Why + Risk Brief over HTTP + Postgres: GET/POST /pulls/:id/brief, the
 * `pr_brief` upsert guard (older flight / superseded head), workspace scoping,
 * the missing-key 422, the 409 without stored files and the POST rate limit.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Do NOT run without approval.
 * Safe run command (guard DATABASE_URL so dotenv can never point the app at the
 * dev DB; the LLM, GitHub and secrets are all fakes, no network is used):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/brief.it.test.ts
 *
 * Notes: the default `risk_brief` model is openai/gpt-4.1, so the LLM is a local
 * counting FakeLLM injected as the `openai` provider (no keys, no network). Every
 * test builds its own PR (own repo, not the seeded PR #482). Stored briefs are
 * inserted directly (built from the seed fixture) so GET/cache tests do not
 * depend on POST. Most tests use the default (test) app; AC-29 uses a second app
 * with nodeEnv 'production' (the rate limiter is not registered under 'test').
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFAULT_MODEL = defaultFeatureModel('risk_brief');

const GOOD = {
  summary: 'Adds retry to the webhook sender so failed deliveries are retried.',
  risks: [
    {
      kind: 'reliability',
      title: 'Retry storm',
      explanation: 'Unbounded retries could hammer a failing endpoint.',
      severity: 'medium',
      file_refs: ['src/sender.ts:3'],
    },
  ],
  review_focus: [{ path: 'src/sender.ts', line: 3, reason: 'The retry loop.' }],
};

/** Counting FakeLLM: records calls + schema names; can be delayed or gated. */
class FakeLLM implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  calls = 0;
  schemaNames: string[] = [];
  delayMs = 0;
  gate: Promise<void> | null = null;
  answer: unknown = GOOD;
  private waiters: Array<() => void> = [];

  constructor(id: 'openai' | 'openrouter' = 'openai') {
    this.id = id;
  }
  reset() {
    this.calls = 0;
    this.schemaNames = [];
    this.delayMs = 0;
    this.gate = null;
    this.answer = GOOD;
    this.waiters = [];
  }
  /** Resolves when the NEXT completeStructured call has started (inputs are already read). */
  nextCall(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  async listModels(): Promise<never> {
    throw new Error('listModels must not be called');
  }
  async complete(): Promise<never> {
    throw new Error('complete must not be called');
  }
  async embed(): Promise<never> {
    throw new Error('embed must not be called');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls += 1;
    this.schemaNames.push(req.schemaName);
    for (const w of this.waiters.splice(0)) w();
    if (this.gate) await this.gate;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return {
      data: this.answer as T,
      model: `${req.model}-resolved`,
      tokensIn: 123,
      tokensOut: 45,
      costUsd: 0.002,
      raw: '',
      attempts: 2,
    };
  }
}

/** Wraps a GitHub client and records every method call (the brief flow must make none). */
function spyOnCalls<T extends object>(target: T, log: string[]): T {
  return new Proxy(target, {
    get(obj, prop) {
      const v = Reflect.get(obj, prop, obj);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        log.push(String(prop));
        return (v as (...a: unknown[]) => unknown).apply(obj, args);
      };
    },
  });
}

d('PR Why + Risk Brief endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let otherWs: string;
  let seq = 0;
  let apps: FastifyInstance[] = [];
  let llm: FakeLLM;
  let openrouter: FakeLLM;
  let ghCalls: string[];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    // The same row LocalNoAuthProvider resolves for every request.
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
    const [o] = await db.insert(t.workspaces).values({ name: 'brief-other' }).returning();
    otherWs = o!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    llm = new FakeLLM('openai');
    openrouter = new FakeLLM('openrouter');
    ghCalls = [];
    apps = [];
    await setFeatureModels(null);
  });
  afterEach(async () => {
    for (const a of apps) await a.close();
    apps = [];
  });

  // ---- helpers ----------------------------------------------------------------

  async function makeApp(
    opts: {
      /** Inject the fake as the `openai` provider (default true). */
      withOpenai?: boolean;
      /** Inject the openrouter fake (to prove no fallback to it). */
      withOpenrouter?: boolean;
      nodeEnv?: 'test' | 'production';
    } = {},
  ): Promise<FastifyInstance> {
    const cfg = { ...config(), ...(opts.nodeEnv === 'production' ? { nodeEnv: 'production' as const, logLevel: 'silent' } : {}) };
    const a = await buildApp({
      config: cfg,
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: spyOnCalls(new MockGitHubClient({ pulls: [] }), ghCalls),
        llm: {
          ...(opts.withOpenai === false ? {} : { openai: llm }),
          ...(opts.withOpenrouter ? { openrouter } : {}),
        },
      },
    });
    apps.push(a);
    return a;
  }

  /** Replace the workspace's `feature_models` setting (null = no row). */
  async function setFeatureModels(value: Record<string, unknown> | null) {
    const db = pg.handle.db;
    await db.delete(t.settings).where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    if (value) await db.insert(t.settings).values({ workspaceId, key: 'feature_models', value });
  }

  async function newPr(
    over: { ws?: string; headSha?: string; files?: Array<{ path: string; additions: number; deletions: number }> } = {},
  ): Promise<string> {
    const db = pg.handle.db;
    const ws = over.ws ?? workspaceId;
    const name = `brief-${seq++}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const files = over.files ?? [
      { path: 'src/sender.ts', additions: 4, deletions: 1 },
      { path: 'src/queue.ts', additions: 2, deletions: 0 },
    ];
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 6000 + seq,
        title: 'Add retry to webhooks',
        author: 'marisa.koch',
        branch: 'feat/retry',
        base: 'main',
        headSha: over.headSha ?? 'brief-sha-1',
        additions: 6,
        deletions: 1,
        filesCount: files.length,
        status: 'needs_review',
        body: 'Retries failed webhook deliveries.',
      })
      .returning();
    for (const f of files) {
      await db.insert(t.prFiles).values({ prId: pr!.id, path: f.path, additions: f.additions, deletions: f.deletions, patch: null });
    }
    return pr!.id;
  }

  /** The seed fixture brief, re-headed / re-dated; fresh against the default model unless overridden. */
  function briefFor(
    headSha: string,
    o: { summary?: string; generated_at?: string; prompt_version?: string } = {},
  ): PrBrief {
    const b = buildSeedBrief({ headSha });
    return {
      ...b,
      summary: o.summary ?? b.summary,
      meta: {
        ...b.meta!,
        ...(o.generated_at ? { generated_at: o.generated_at } : {}),
        ...(o.prompt_version ? { prompt_version: o.prompt_version } : {}),
      },
    };
  }

  async function insertBrief(prId: string, brief: PrBrief) {
    await pg.handle.db.insert(t.prBrief).values({ prId, json: brief });
  }
  async function readRow(prId: string) {
    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }
  async function setHead(prId: string, headSha: string) {
    await pg.handle.db.update(t.pullRequests).set({ headSha }).where(eq(t.pullRequests.id, prId));
  }

  const get = (a: FastifyInstance, id: string) => a.inject({ method: 'GET', url: `/pulls/${id}/brief` });
  const post = (a: FastifyInstance, id: string, payload?: { force: boolean }) =>
    a.inject({ method: 'POST', url: `/pulls/${id}/brief`, payload });

  // ---- generation -------------------------------------------------------------

  it('AC-BRIEF-01 one POST that regenerates issues exactly one completeStructured call', async () => {
    const a = await makeApp();
    const id = await newPr();

    const res = await post(a, id);
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toBe(1);
    expect(llm.schemaNames).toEqual([SCHEMA_NAME]);
    expect(res.json()).toMatchObject({ pr_id: id, freshness: 'fresh', stale_reasons: [] });
    expect(res.json().brief.summary).toBe(GOOD.summary);
    expect(ghCalls).toEqual([]);
  });

  it('AC-BRIEF-07 generating does not call the intent LLM and does not write pr_intent', async () => {
    const a = await makeApp();
    const id = await newPr();
    await pg.handle.db.insert(t.prIntent).values({ prId: id, intent: 'Stored intent', inScope: ['retry'], outOfScope: [] });
    const before = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, id));
    const countBefore = (await pg.handle.db.select().from(t.prIntent)).length;

    const res = await post(a, id, { force: true });
    expect(res.statusCode).toBe(200);

    // exactly one model call and it is the brief schema, not the intent one
    expect(llm.calls).toBe(1);
    expect(llm.schemaNames).toEqual([SCHEMA_NAME]);
    // the stored intent is only read (it ends up in the brief), the table is untouched
    expect(await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, id))).toEqual(before);
    expect((await pg.handle.db.select().from(t.prIntent)).length).toBe(countBefore);
    expect(res.json().brief.meta.intent_available).toBe(true);
    expect(res.json().brief.intent.intent).toBe('Stored intent');
  });

  it('AC-BRIEF-13 success upserts pr_brief.json with the validated brief and the full meta', async () => {
    const a = await makeApp();
    const id = await newPr({ headSha: 'brief-sha-meta' });
    expect(await readRow(id)).toBeUndefined();

    const res = await post(a, id);
    expect(res.statusCode).toBe(200);

    const row = await readRow(id);
    const stored = PrBrief.parse(row!.json);
    expect(stored.summary).toBe(GOOD.summary);
    expect(stored.review_focus).toEqual(GOOD.review_focus);
    expect(stored.risks.risks).toHaveLength(1);
    expect(stored.meta).toEqual({
      head_sha: 'brief-sha-meta',
      provider: DEFAULT_MODEL.provider,
      model: DEFAULT_MODEL.model, // the REQUESTED id, not the provider-resolved `-resolved` one
      prompt_version: BRIEF_PROMPT_VERSION,
      tokens_in: 123, // unchanged from StructuredResult
      tokens_out: 45,
      attempts: 2,
      cost_usd: 0.002,
      generated_at: expect.stringMatching(ISO),
      truncated: false,
      intent_available: false,
    });
    expect(res.json().brief).toEqual(JSON.parse(JSON.stringify(stored)));
  });

  it('AC-BRIEF-13/19 older flight cannot overwrite a newer row', async () => {
    const id = await newPr({ headSha: 'brief-sha-order' });
    const repo = new BriefRepository(pg.handle.db);
    const T1 = '2026-10-18T10:00:00.000Z';
    const T2 = '2026-10-18T10:00:10.000Z';

    expect(await repo.saveBrief({ prId: id, brief: briefFor('brief-sha-order', { summary: 'NEWER', generated_at: T2 }) })).toBe(true);
    // same head, older generated_at -> skipped
    expect(await repo.saveBrief({ prId: id, brief: briefFor('brief-sha-order', { summary: 'OLDER', generated_at: T1 }) })).toBe(false);

    const stored = PrBrief.parse((await readRow(id))!.json);
    expect(stored.summary).toBe('NEWER');
    expect(stored.meta?.generated_at).toBe(T2);

    // an equal-or-later flight on the same head does overwrite
    expect(await repo.saveBrief({ prId: id, brief: briefFor('brief-sha-order', { summary: 'LATEST', generated_at: '2026-10-18T10:00:20.000Z' }) })).toBe(true);
    expect(PrBrief.parse((await readRow(id))!.json).summary).toBe('LATEST');
  });

  it('AC-BRIEF-13/19 flight for a superseded head is not saved even with a later generated_at', async () => {
    const a = await makeApp();
    const id = await newPr({ headSha: 'brief-sha-old' });
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const started = llm.nextCall();

    const inFlight = post(a, id, { force: true }); // reads head 'brief-sha-old', takes generated_at = now
    await started;

    // The PR moves on and a brief for the NEW head (older generated_at) is stored meanwhile.
    await setHead(id, 'brief-sha-new');
    await insertBrief(id, briefFor('brief-sha-new', { summary: 'CURRENT-HEAD', generated_at: '2026-01-01T00:00:00.000Z' }));
    release();

    const res = await inFlight;
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toBe(1);

    const stored = PrBrief.parse((await readRow(id))!.json);
    expect(stored.summary).toBe('CURRENT-HEAD');
    expect(stored.meta?.head_sha).toBe('brief-sha-new');
    // the response reports the STORED state, not the discarded result
    expect(res.json().brief.summary).toBe('CURRENT-HEAD');
    expect(res.json().freshness).toBe('fresh');
  });

  // ---- GET --------------------------------------------------------------------

  it('AC-BRIEF-14 GET with a stored row returns it without any LLM or GitHub call', async () => {
    const a = await makeApp();
    const id = await newPr();
    await insertBrief(id, briefFor('brief-sha-1'));

    const res = await get(a, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pr_id: id, freshness: 'fresh', stale_reasons: [], model_error: null });
    expect(res.json().brief.summary).toBe(SEED_BRIEF_SUMMARY);
    await get(a, id);
    expect(llm.calls).toBe(0);
    expect(openrouter.calls).toBe(0);
    expect(ghCalls).toEqual([]);
  });

  it('AC-BRIEF-15 GET with no row returns brief null and freshness unknown', async () => {
    const a = await makeApp();
    const id = await newPr();

    const res = await get(a, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pr_id: id, brief: null, freshness: 'unknown', stale_reasons: [] });
    expect(llm.calls).toBe(0);
    expect(await readRow(id)).toBeUndefined();
  });

  it('AC-BRIEF-16 stale reasons: a moved head, a changed risk_brief model, an old prompt_version', async () => {
    const a = await makeApp();

    // head moved -> pr_changed
    const moved = await newPr({ headSha: 'brief-sha-a' });
    await insertBrief(moved, briefFor('brief-sha-a'));
    expect((await get(a, moved)).json()).toMatchObject({ freshness: 'fresh' });
    await setHead(moved, 'brief-sha-b');
    expect((await get(a, moved)).json()).toMatchObject({ freshness: 'stale', stale_reasons: ['pr_changed'] });

    // risk_brief override -> model_changed
    const model = await newPr();
    await insertBrief(model, briefFor('brief-sha-1'));
    await setFeatureModels({ risk_brief: { provider: 'openai', model: 'brief-override-model' } });
    expect((await get(a, model)).json()).toMatchObject({ freshness: 'stale', stale_reasons: ['model_changed'] });
    await setFeatureModels(null);

    // old prompt version -> prompt_changed
    const prompt = await newPr();
    await insertBrief(prompt, briefFor('brief-sha-1', { prompt_version: 'brief-v0' }));
    expect((await get(a, prompt)).json()).toMatchObject({ freshness: 'stale', stale_reasons: ['prompt_changed'] });

    expect(llm.calls).toBe(0);
  });

  // ---- POST cache / force / single-flight ----------------------------------------

  it('AC-BRIEF-17 POST with force false and a fresh stored brief returns it without an LLM call', async () => {
    const a = await makeApp();
    const id = await newPr();
    const stored = briefFor('brief-sha-1');
    await insertBrief(id, stored);

    const res = await post(a, id, { force: false });
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toBe(0);
    expect(res.json()).toMatchObject({ freshness: 'fresh' });
    expect(res.json().brief.summary).toBe(SEED_BRIEF_SUMMARY);
    expect((await readRow(id))!.json).toEqual(JSON.parse(JSON.stringify(stored)));

    // an empty body means force false too
    expect((await post(a, id)).statusCode).toBe(200);
    expect(llm.calls).toBe(0);
  });

  it('AC-BRIEF-18 POST with force true regenerates even when the brief is fresh', async () => {
    const a = await makeApp();
    const id = await newPr();
    await insertBrief(id, briefFor('brief-sha-1'));

    const res = await post(a, id, { force: true });
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toBe(1);
    expect(res.json().brief.summary).toBe(GOOD.summary);
    const stored = PrBrief.parse((await readRow(id))!.json);
    expect(stored.summary).toBe(GOOD.summary);
    expect(stored.meta!.generated_at > '2026-01-01T00:00:00.000Z').toBe(true);
  });

  it('AC-BRIEF-19 concurrent POSTs for one PR share a single model call', async () => {
    const a = await makeApp();
    const id = await newPr();
    llm.delayMs = 300;

    const [r1, r2] = await Promise.all([post(a, id), post(a, id)]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(llm.calls).toBe(1);
    expect(r1.json().freshness).toBe('fresh');
    expect(r2.json().freshness).toBe('fresh');
    expect(r1.json().brief.meta.generated_at).toBe(r2.json().brief.meta.generated_at);
  });

  // ---- failures ---------------------------------------------------------------

  it('AC-BRIEF-20 no API key for the risk_brief provider: 422, fixed message, no fallback, row unchanged', async () => {
    // openrouter IS available: a silent fallback would call it. The default risk_brief provider (openai) has no key.
    const a = await makeApp({ withOpenai: false, withOpenrouter: true });
    const id = await newPr();
    const stored = briefFor('brief-sha-1');
    await insertBrief(id, stored);

    for (const payload of [undefined, { force: true }]) {
      const res = await post(a, id, payload);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('brief_model_unavailable');
      expect(res.json().error.message).toBe(BRIEF_MODEL_UNAVAILABLE_MESSAGE);
    }
    expect(openrouter.calls).toBe(0);
    expect(llm.calls).toBe(0);
    expect((await readRow(id))!.json).toEqual(JSON.parse(JSON.stringify(stored)));

    // GET still shows the brief and reports the model problem
    const state = await get(a, id);
    expect(state.statusCode).toBe(200);
    expect(state.json().brief).not.toBeNull();
    expect(state.json().model_error).toBe(BRIEF_MODEL_UNAVAILABLE_MESSAGE);

    // and with no row at all nothing is created
    const bare = await newPr();
    expect((await post(a, bare)).statusCode).toBe(422);
    expect(await readRow(bare)).toBeUndefined();
    expect(openrouter.calls).toBe(0);
  });

  it('AC-BRIEF-22 a PR from another workspace is 404 on GET and POST', async () => {
    const a = await makeApp();
    const foreign = await newPr({ ws: otherWs });
    await insertBrief(foreign, briefFor('brief-sha-1', { summary: 'FOREIGN-SECRET' }));
    const missing = '00000000-0000-4000-8000-00000000dead';

    for (const id of [foreign, missing]) {
      for (const res of [await get(a, id), await post(a, id), await post(a, id, { force: true })]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe('not_found');
        expect(JSON.stringify(res.json())).not.toContain('FOREIGN-SECRET');
      }
    }
    expect(llm.calls).toBe(0);
    expect(ghCalls).toEqual([]);
  });

  it('AC-BRIEF-23 a non-uuid :id is 422 on GET and POST', async () => {
    const a = await makeApp();
    expect((await get(a, 'not-a-uuid')).statusCode).toBe(422);
    expect((await post(a, 'not-a-uuid')).statusCode).toBe(422);
    expect(llm.calls).toBe(0);
  });

  it('AC-BRIEF-46 a PR without stored pr_files: 409, no LLM call, pr_brief unchanged', async () => {
    const a = await makeApp();
    const id = await newPr({ files: [] });
    const stored = briefFor('brief-sha-1');
    await insertBrief(id, stored);

    for (const payload of [undefined, { force: true }]) {
      const res = await post(a, id, payload);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('brief_inputs_incomplete');
    }
    expect(llm.calls).toBe(0);
    expect((await readRow(id))!.json).toEqual(JSON.parse(JSON.stringify(stored)));

    const bare = await newPr({ files: [] });
    expect((await post(a, bare)).statusCode).toBe(409);
    expect(await readRow(bare)).toBeUndefined();
  });

  // ---- rate limit -------------------------------------------------------------

  it('AC-BRIEF-29 more than 10 POSTs in a minute: the 11th is 429 (production app, cache hits only)', async () => {
    const a = await makeApp({ nodeEnv: 'production' }); // own app => own in-memory limiter
    const id = await newPr();
    await insertBrief(id, briefFor('brief-sha-1')); // fresh: every POST is a cache hit, no LLM

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post(a, id)).statusCode);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect(llm.calls).toBe(0);
  });
});
