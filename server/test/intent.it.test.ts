import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';
import { INTENT_PROMPT_VERSION } from '../src/modules/reviews/intent/constants.js';
import { getIntentRow, saveIntent, type SaveIntentValues } from '../src/modules/reviews/repository/intent.repo.js';

/**
 * L03 Intent block (P1 backend) over HTTP + Postgres: GET/POST /pulls/:id/intent,
 * the pr_intent upsert race guard, legacy rows, the model chain and the cascade.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Do NOT run without approval.
 * Safe run command (guard DATABASE_URL so dotenv can never point the app at the
 * dev DB; the LLM, GitHub and secrets are all fakes, no network is used):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/intent.it.test.ts
 *
 * Notes: the model is a local FakeLLM (MockLLMProvider only knows the openai /
 * anthropic ids; the intent chain uses openrouter). Rows are inserted directly,
 * patches carry real `@@ -a,b +c,d @@ fn` headers (the fingerprint hashes them).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const GOOD = {
  intent: 'Adds retry to the webhook sender',
  in_scope: ['retry loop'],
  out_of_scope: ['dead-letter queue'],
  risk_areas: ['webhook delivery'],
  confidence: 'high',
};

const OVERRIDE = { provider: 'openrouter', model: 'fake/intent-model' } as const;

/** Counting FakeLLM: can resolve, throw or be delayed; remembers requested model ids. */
class FakeLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  calls = 0;
  models: string[] = [];
  answer: unknown = GOOD;
  fail: Error | null = null;
  delayMs = 0;
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
    this.models.push(req.model);
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.fail) throw this.fail;
    return { data: this.answer as T, model: `${req.model}-resolved`, tokensIn: 123, tokensOut: 45, costUsd: 0.002, raw: '', attempts: 1 };
  }
}

/** Wraps a GitHub client and records every method call (the intent flow must make none). */
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

const PATCH_A = '@@ -1,3 +1,5 @@ function send()\n context\n+retry\n+more\n context';
const PATCH_B = '@@ -10,2 +12,4 @@ class Queue\n x\n+y\n+z\n x';

d('L03 Intent block (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;
  let app: FastifyInstance | null = null;
  let llm: FakeLLM;
  let ghCalls: string[];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    // The same row LocalNoAuthProvider resolves for every request.
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    llm = new FakeLLM();
    ghCalls = [];
    await setFeatureModels(null);
  });
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  // ---- helpers ----------------------------------------------------------------

  async function makeApp(opts: { withLlm?: boolean; secrets?: Record<string, string> } = {}): Promise<FastifyInstance> {
    const github = spyOnCalls(new MockGitHubClient({ pulls: [] }), ghCalls);
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider(opts.secrets ?? {}),
        github,
        ...(opts.withLlm === false ? {} : { llm: { openrouter: llm } }),
      },
    });
    return app;
  }

  /** Replace the workspace's `feature_models` setting (null = no row). */
  async function setFeatureModels(value: Record<string, unknown> | null) {
    const db = pg.handle.db;
    await db.delete(t.settings).where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    if (value) await db.insert(t.settings).values({ workspaceId, key: 'feature_models', value });
  }

  async function newPr(over: { ws?: string; body?: string | null; headSha?: string; files?: Array<{ path: string; patch: string | null }>; filesCount?: number } = {}) {
    const db = pg.handle.db;
    const ws = over.ws ?? workspaceId;
    const name = `intent-${seq++}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const files = over.files ?? [
      { path: 'src/sender.ts', patch: PATCH_A },
      { path: 'src/queue.ts', patch: PATCH_B },
    ];
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 2000 + seq,
        title: 'Add retry to webhooks',
        author: 'marisa.koch',
        branch: 'feat/retry',
        base: 'main',
        headSha: over.headSha ?? 'sha-1',
        additions: 4,
        deletions: 0,
        filesCount: over.filesCount ?? files.length,
        status: 'needs_review',
        body: over.body === undefined ? 'Retries failed webhook deliveries.' : over.body,
      })
      .returning();
    for (const f of files) {
      await db.insert(t.prFiles).values({ prId: pr!.id, path: f.path, additions: 2, deletions: 0, patch: f.patch });
    }
    return pr!.id;
  }

  async function get(a: FastifyInstance, id: string) {
    return await a.inject({ method: 'GET', url: `/pulls/${id}/intent` });
  }
  async function post(a: FastifyInstance, id: string, payload?: { force: boolean }) {
    return await a.inject({ method: 'POST', url: `/pulls/${id}/intent`, payload });
  }

  // ---- 1. GET is a pure local read --------------------------------------------

  it('GET with no row -> intent null, unknown, 0 LLM calls, GitHub untouched; still 0 after rows exist', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();

    const empty = await get(a, id);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      pr_id: id,
      intent: null,
      meta: null,
      freshness: 'unknown',
      stale_reasons: [],
      current_model: { ...OVERRIDE, source: 'override' },
    });
    expect(llm.calls).toBe(0);

    // A stored row exists now (written by POST): GETs still never call the model.
    expect((await post(a, id)).statusCode).toBe(200);
    const callsAfterPost = llm.calls;
    const after = await get(a, id);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ freshness: 'fresh', stale_reasons: [] });
    await get(a, id);
    expect(llm.calls).toBe(callsAfterPost);
    expect(ghCalls).toEqual([]);
  });

  // ---- 2. POST writes the row + meta; second POST is a cache hit ---------------

  it('POST writes the row with full meta (computed true); second POST is a cache hit (computed false)', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr({ headSha: 'sha-meta' });

    const first = await post(a, id);
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body).toMatchObject({ computed: true, freshness: 'fresh', stale_reasons: [] });
    expect(body.intent).toEqual({
      intent: GOOD.intent,
      in_scope: GOOD.in_scope,
      out_of_scope: GOOD.out_of_scope,
      risk_areas: GOOD.risk_areas,
    });
    expect(body.meta).toMatchObject({
      provider: 'openrouter',
      model: OVERRIDE.model, // the REQUESTED id, not the provider-resolved `-resolved` one
      prompt_version: INTENT_PROMPT_VERSION,
      confidence: 'high',
      head_sha: 'sha-meta',
      tokens_in: 123,
      tokens_out: 45,
      cost_usd: 0.002,
    });
    expect(Date.parse(body.meta.generated_at)).not.toBeNaN();
    expect(Date.parse(body.meta.input_snapshot_at)).not.toBeNaN();
    expect(llm.calls).toBe(1);
    expect(llm.models).toEqual([OVERRIDE.model]);

    const row = await getIntentRow(pg.handle.db, id);
    expect(row).toMatchObject({
      prId: id,
      provider: 'openrouter',
      model: OVERRIDE.model,
      promptVersion: INTENT_PROMPT_VERSION,
      confidence: 'high',
      headSha: 'sha-meta',
      tokensIn: 123,
      tokensOut: 45,
      costUsd: 0.002,
    });
    expect(row?.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.inputSnapshotAt).toBeInstanceOf(Date);
    expect(row?.generatedAt).toBeInstanceOf(Date);

    const second = await post(a, id);
    expect(second.json()).toMatchObject({ computed: false, freshness: 'fresh' });
    expect(llm.calls).toBe(1);
    // the stored row was not rewritten
    expect((await getIntentRow(pg.handle.db, id))?.generatedAt).toEqual(row!.generatedAt);
    expect(ghCalls).toEqual([]);
  });

  // ---- 3. PR edited at the same head sha --------------------------------------

  it('editing pull_requests.body -> GET stale/pr_changed at the same head_sha; POST force recomputes', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr({ headSha: 'sha-same' });
    await post(a, id);
    expect(llm.calls).toBe(1);

    await pg.handle.db.update(t.pullRequests).set({ body: 'Totally different description.' }).where(eq(t.pullRequests.id, id));

    const stale = (await get(a, id)).json();
    expect(stale.freshness).toBe('stale');
    expect(stale.stale_reasons).toEqual(['pr_changed']);
    expect(stale.meta.head_sha).toBe('sha-same');
    expect(llm.calls).toBe(1); // GET did not recompute

    const forced = await post(a, id, { force: true });
    expect(forced.json()).toMatchObject({ computed: true, freshness: 'fresh', stale_reasons: [] });
    expect(llm.calls).toBe(2);
  });

  // ---- 4. Files not synced -> unknown, not stale ------------------------------

  it('pr_files empty while files_count > 0 -> freshness unknown (not stale), no reasons', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();
    await post(a, id);

    await pg.handle.db.delete(t.prFiles).where(eq(t.prFiles.prId, id));
    const [pr] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, id));
    expect(pr!.filesCount).toBeGreaterThan(0);

    const res = await get(a, id);
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.freshness).toBe('unknown');
    expect(state.stale_reasons).toEqual([]);
    expect(state.intent).not.toBeNull();

    // The model is never called on an unknown file list: POST returns the stored intent,
    // force is refused with 409 (it means "ignore cache", not "accept incomplete input").
    const callsBefore = llm.calls;
    const again = await post(a, id);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ computed: false, freshness: 'unknown' });
    const forced = await post(a, id, { force: true });
    expect(forced.statusCode).toBe(409);
    expect(forced.json().error.code).toBe('intent_inputs_incomplete');
    expect(llm.calls).toBe(callsBefore);
  });

  it('imported PR without pr_files and without a stored intent -> POST 409 intent_inputs_incomplete, 0 calls', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr({ files: [], filesCount: 0 });
    const res = await post(a, id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('intent_inputs_incomplete');
    expect(llm.calls).toBe(0);
    expect(await getIntentRow(pg.handle.db, id)).toBeUndefined();
  });

  // ---- 5. LLM failure -> 502, row untouched -----------------------------------

  it('LLM throws -> 502 external_service_error and the stored row is unchanged', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();
    await post(a, id);
    const before = await getIntentRow(pg.handle.db, id);

    llm.fail = new Error('provider exploded');
    const res = await post(a, id, { force: true });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('external_service_error');
    expect(llm.calls).toBe(2);

    expect(await getIntentRow(pg.handle.db, id)).toEqual(before);

    // and with no prior row nothing is created
    const id2 = await newPr();
    expect((await post(a, id2)).statusCode).toBe(502);
    expect(await getIntentRow(pg.handle.db, id2)).toBeUndefined();
  });

  // ---- 6. Concurrency through the real app ------------------------------------

  it('concurrent identical POSTs share exactly ONE LLM call', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();
    llm.delayMs = 300;

    const [r1, r2] = await Promise.all([post(a, id), post(a, id)]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(llm.calls).toBe(1);
    expect([r1.json().computed, r2.json().computed].sort()).toEqual([false, true]);
    expect(r1.json().freshness).toBe('fresh');
    expect(r2.json().freshness).toBe('fresh');
  });

  // ---- 7. DB-level race guard on saveIntent -----------------------------------

  describe('saveIntent snapshot guard (pr_intent upsert)', () => {
    const T1 = new Date('2026-10-16T10:00:00.000Z');
    const T2 = new Date('2026-10-16T10:00:10.000Z');
    const values = (prId: string, intent: string, at: Date): SaveIntentValues => ({
      prId,
      intent,
      inScope: [intent],
      outOfScope: [],
      riskAreas: [],
      confidence: 'medium',
      inputFingerprint: `fp-${intent}`,
      promptVersion: INTENT_PROMPT_VERSION,
      provider: 'openrouter',
      model: 'fake/m',
      headSha: `sha-${intent}`,
      inputSnapshotAt: at,
      tokensIn: 1,
      tokensOut: 2,
      costUsd: 0.5,
    });

    it('newer snapshot first, older second -> row keeps the newer values; second returns false', async () => {
      const id = await newPr();
      expect(await saveIntent(pg.handle.db, values(id, 'NEWER', T2))).toBe(true);
      expect(await saveIntent(pg.handle.db, values(id, 'OLDER', T1))).toBe(false);
      const row = await getIntentRow(pg.handle.db, id);
      expect(row).toMatchObject({ intent: 'NEWER', inputFingerprint: 'fp-NEWER', headSha: 'sha-NEWER' });
      expect(row?.inputSnapshotAt?.toISOString()).toBe(T2.toISOString());
    });

    it('older first, newer second -> the newer overwrites', async () => {
      const id = await newPr();
      expect(await saveIntent(pg.handle.db, values(id, 'OLDER', T1))).toBe(true);
      expect(await saveIntent(pg.handle.db, values(id, 'NEWER', T2))).toBe(true);
      expect((await getIntentRow(pg.handle.db, id))?.intent).toBe('NEWER');
    });

    it('equal snapshot overwrites (<=)', async () => {
      const id = await newPr();
      expect(await saveIntent(pg.handle.db, values(id, 'FIRST', T2))).toBe(true);
      expect(await saveIntent(pg.handle.db, values(id, 'SECOND', T2))).toBe(true);
      expect((await getIntentRow(pg.handle.db, id))?.intent).toBe('SECOND');
    });

    it('a legacy row with NULL input_snapshot_at is overwritten', async () => {
      const id = await newPr();
      await pg.handle.db.insert(t.prIntent).values({ prId: id, intent: 'LEGACY', inScope: [], outOfScope: [] });
      expect((await getIntentRow(pg.handle.db, id))?.inputSnapshotAt).toBeNull();
      expect(await saveIntent(pg.handle.db, values(id, 'NEW', T1))).toBe(true);
      const row = await getIntentRow(pg.handle.db, id);
      expect(row).toMatchObject({ intent: 'NEW', provider: 'openrouter', promptVersion: INTENT_PROMPT_VERSION });
      expect(row?.inputSnapshotAt?.toISOString()).toBe(T1.toISOString());
    });
  });

  // ---- 8. Legacy row freshness -------------------------------------------------

  it('legacy row (NULL new columns) -> stale with pr_changed, prompt_changed, model_changed', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();
    await pg.handle.db.insert(t.prIntent).values({ prId: id, intent: 'Old intent', inScope: ['a'], outOfScope: [] });

    const res = await get(a, id);
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.freshness).toBe('stale');
    expect(state.stale_reasons).toEqual(['pr_changed', 'prompt_changed', 'model_changed']);
    expect(state.intent).toMatchObject({ intent: 'Old intent', in_scope: ['a'], risk_areas: [] });
    expect(state.meta).toMatchObject({
      provider: null,
      model: null,
      prompt_version: null,
      confidence: null,
      head_sha: null,
      input_snapshot_at: null,
    });
    expect(llm.calls).toBe(0);

    // a normal POST (no force) heals it: the legacy row is never a cache hit
    const healed = await post(a, id);
    expect(healed.json()).toMatchObject({ computed: true, freshness: 'fresh', stale_reasons: [] });
    expect(llm.calls).toBe(1);
  });

  // ---- 9. Model chain end to end ----------------------------------------------

  describe('model chain', () => {
    it('no override + a provider key (llm override) -> onboarding fallback; the review_intent registry default is never used', async () => {
      const a = await makeApp();
      const id = await newPr();
      const fallback = defaultFeatureModel('onboarding');
      expect(fallback.provider).toBe('openrouter'); // the fake only serves openrouter

      const state = (await get(a, id)).json();
      expect(state.current_model).toEqual({ provider: fallback.provider, model: fallback.model, source: 'fallback_onboarding' });
      expect(state.model_error ?? null).toBeNull();

      const res = await post(a, id);
      expect(res.statusCode).toBe(200);
      expect(res.json().meta).toMatchObject({ provider: fallback.provider, model: fallback.model });
      expect(llm.models).toEqual([fallback.model]);
      expect(llm.models).not.toContain('gpt-4.1');
      expect(llm.models).not.toContain('openai/gpt-4.1');
    });

    it('a workspace onboarding override is the fallback model', async () => {
      await setFeatureModels({ onboarding: { provider: 'openrouter', model: 'x/onboarding-pick' } });
      const a = await makeApp();
      const id = await newPr();
      const res = await post(a, id);
      expect(res.statusCode).toBe(200);
      expect(res.json().current_model).toEqual({ provider: 'openrouter', model: 'x/onboarding-pick', source: 'fallback_onboarding' });
      expect(llm.models).toEqual(['x/onboarding-pick']);
    });

    it('an explicit review_intent override wins over the fallback', async () => {
      await setFeatureModels({
        review_intent: OVERRIDE,
        onboarding: { provider: 'openrouter', model: 'x/onboarding-pick' },
      });
      const a = await makeApp();
      const id = await newPr();
      const res = await post(a, id);
      expect(res.json().current_model).toEqual({ ...OVERRIDE, source: 'override' });
      expect(llm.models).toEqual([OVERRIDE.model]);
    });

    it('no keys at all (no llm override, empty secrets) -> POST 422 intent_model_unavailable, GET reports model_error, 0 calls', async () => {
      const a = await makeApp({ withLlm: false, secrets: {} });
      const id = await newPr();

      const res = await post(a, id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('intent_model_unavailable');
      expect(res.json().error.message).toContain('Settings > Models');
      expect(await getIntentRow(pg.handle.db, id)).toBeUndefined();

      const state = await get(a, id);
      expect(state.statusCode).toBe(200);
      expect(state.json()).toMatchObject({ intent: null, current_model: null });
      expect(state.json().model_error).toContain('Settings > Models');
      expect(llm.calls).toBe(0);
    });

    it('explicit review_intent override whose provider has no key -> 422, no silent fallback to onboarding', async () => {
      await setFeatureModels({ review_intent: { provider: 'openai', model: 'gpt-4.1' } });
      // the openrouter fake IS available, so a silent fallback would succeed and call it
      const a = await makeApp({ secrets: {} });
      const id = await newPr();

      const res = await post(a, id);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('intent_model_unavailable');
      expect(llm.calls).toBe(0);
      expect(llm.models).not.toContain('gpt-4.1');
      expect(await getIntentRow(pg.handle.db, id)).toBeUndefined();
    });
  });

  // ---- 10. Not found / tenancy --------------------------------------------------

  it('unknown PR id and a PR from another workspace -> 404 for GET and POST; the model is never called', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();

    const missing = '00000000-0000-4000-8000-00000000dead';
    for (const res of [await get(a, missing), await post(a, missing)]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }

    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const foreignPr = await newPr({ ws: other!.id });
    for (const res of [await get(a, foreignPr), await post(a, foreignPr, { force: true })]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    expect(llm.calls).toBe(0);
    expect(await getIntentRow(pg.handle.db, foreignPr)).toBeUndefined();
    expect(ghCalls).toEqual([]);
  });

  // ---- 11. Cascade --------------------------------------------------------------

  it('deleting the pull request deletes its pr_intent row', async () => {
    await setFeatureModels({ review_intent: OVERRIDE });
    const a = await makeApp();
    const id = await newPr();
    await post(a, id);
    expect(await getIntentRow(pg.handle.db, id)).toBeDefined();

    await pg.handle.db.delete(t.pullRequests).where(eq(t.pullRequests.id, id));
    expect(await getIntentRow(pg.handle.db, id)).toBeUndefined();
    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, id));
    expect(rows).toHaveLength(0);
  });
});
