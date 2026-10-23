import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AgentEvalRun, LLMProvider } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { groupsFromStored, StoredCaseOutput } from '../src/modules/evals/runner.js';
import { scoreSuite } from '../src/modules/evals/scoring.js';
import { addedFileDiff, assertThrowawayDb, finding, review, ScriptedLLM } from './helpers/eval-fixtures.js';

/**
 * L06 eval runs end to end (specs/eval-pipeline.md §9-§11; ACs 09-13, 21-23,
 * 30) on a THROWAWAY Testcontainers Postgres, with the real reviewer-core
 * engine and a scripted in-memory LLM — no network, no paid call.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = addedFileDiff({ 'src/a.ts': 30 });

d('L06 eval runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    assertThrowawayDb(pg.url);
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const config = () => loadConfig({ ...process.env, DATABASE_URL: pg.url, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
  const appWith = (llm?: LLMProvider) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient({ pulls: [] }),
        git: new MockGitClient({ diff: DIFF }),
        embedder: new MockEmbedder(),
        ...(llm ? { llm: { openrouter: llm } } : {}),
      },
    });

  /** PR + agent + review with findings, decided through the API, turned into cases. */
  async function seedAgentWithCases(
    app: Awaited<ReturnType<typeof appWith>>,
    decisions: [number, 'accept' | 'dismiss'][] = [
      [5, 'accept'],
      [10, 'accept'],
      [20, 'dismiss'],
    ],
  ) {
    const db = pg.handle.db;
    const name = `run-${randomUUID().slice(0, 8)}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: 5, title: 'Frozen PR', author: 'dev', branch: 'b', base: 'main', headSha: 'h5', body: 'Frozen body' })
      .returning();
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId, name: `Runner ${name}`, provider: 'openrouter', model: 'm', systemPrompt: 'prompt v1', strategy: 'single-pass', repoIntel: false })
      .returning();
    const [rev] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: agent!.id, runId: null, kind: 'review', verdict: 'comment', summary: 's', score: 1, model: 'm' })
      .returning();
    const mk = async (line: number, action: 'accept' | 'dismiss') => {
      const [f] = await db
        .insert(t.findings)
        .values({ reviewId: rev!.id, file: 'src/a.ts', startLine: line, endLine: line, severity: 'WARNING', category: 'bug', title: `L${line}`, rationale: 'r', confidence: 1 })
        .returning();
      await app.inject({ method: 'POST', url: `/findings/${f!.id}/${action}` });
      const res = await app.inject({ method: 'POST', url: `/findings/${f!.id}/eval-case` });
      expect(res.statusCode).toBe(201);
    };
    for (const [line, action] of decisions) await mk(line, action);
    return { agentId: agent!.id, prId: pr!.id };
  }

  async function waitForRun(app: Awaited<ReturnType<typeof appWith>>, agentId: string, runId: string): Promise<AgentEvalRun> {
    const until = Date.now() + 20_000;
    for (;;) {
      const runs = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun[];
      const run = runs.find((r) => r.id === runId);
      if (run && run.status !== 'running') return run;
      if (Date.now() > until) throw new Error('eval run did not finish');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** DB-side JSON of the product tables an eval run must never modify. */
  async function productSnapshot() {
    const sql = pg.handle.sql;
    const rows = async (table: string) =>
      (await sql.unsafe(`select to_jsonb(x) as j from ${table} x order by id`)).map((r) => JSON.stringify(r.j));
    return {
      findings: await rows('findings'),
      reviews: await rows('reviews'),
      pull_requests: await rows('pull_requests'),
      agent_runs: await rows('agent_runs'),
      agents: await rows('agents'),
    };
  }

  it('runs the agent on frozen inputs, stores results, scores them and touches no product data', async () => {
    // Model answer: one TP (a.ts:5), a duplicate of it, a hit on the dismissed line 20, a hallucinated line.
    const llm = new ScriptedLLM([review([finding('src/a.ts', 5), finding('src/a.ts', 5, 5, { id: 'dup' }), finding('src/a.ts', 20), finding('src/a.ts', 400)])]);
    const app = await appWith(llm);
    const { agentId } = await seedAgentWithCases(app);
    const before = await productSnapshot();

    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs`, payload: {} });
    expect(res.statusCode).toBe(202);
    const started = res.json() as AgentEvalRun;
    expect(started.status).toBe('running');

    const run = await waitForRun(app, agentId, started.id);
    expect(run.status).toBe('done');
    expect(llm.requests).toHaveLength(1); // 3 cases, 1 frozen input → 1 engine call
    // kept = a:5, a:5 (dup), a:20; dropped = a:400. TP 1, FN 1 (a:10), FP 2 (duplicate + negative_hit)
    expect(run.counts).toMatchObject({ tp: 1, fn: 1, fp: 2, kept: 3, raw: 4, valid_citations: 3, cases_total: 3, cases_passed: 1 });
    expect(run.counts!.fp_by_reason).toEqual({ too_wide: 0, duplicate: 1, negative_hit: 1, unlabeled: 0 });
    expect(run.recall).toBe(0.5);
    expect(run.precision).toBeCloseTo(1 / 3);
    expect(run.citation_accuracy).toBe(0.75);
    expect(run.cost_usd).toBeCloseTo(0.002);

    // frozen input only: the stored case diff + PR text, not repo-intel / intent / context
    const prompt = llm.requests[0]!.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('Frozen PR');
    expect(prompt).toContain('prompt v1');
    expect(prompt).not.toContain('## Repo skeleton');
    expect(prompt).not.toContain('## PR intent');

    // stored per-case results + config snapshot
    const [row] = await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.id, run.id));
    expect(row!.configSnapshot).toMatchObject({ system_prompt: 'prompt v1', provider: 'openrouter', skills: [] });
    const results = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, run.id));
    expect(results).toHaveLength(3);
    for (const r of results) StoredCaseOutput.parse(r.actualOutput);
    expect(results.map((r) => r.outcome).sort()).toEqual(['fail', 'fn', 'tp']);

    // re-score from what is stored → identical metrics
    const cases = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    const again = scoreSuite(groupsFromStored(cases, results));
    expect([again.recall, again.precision, again.citation_accuracy]).toEqual([run.recall, run.precision, run.citation_accuracy]);

    // last result shows up on the case list
    const listed = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json();
    expect(listed.every((c: { last_result: { suite_run_id: string } | null }) => c.last_result?.suite_run_id === run.id)).toBe(true);

    // the product tables are byte-for-byte unchanged (findings, decisions, reviews, PRs, runs, agents)
    expect(await productSnapshot()).toEqual(before);
    await app.close();
  });

  it('a prompt edit gives a new version and prompt_sha; history is newest first (AC-23)', async () => {
    const llm = new ScriptedLLM([review([finding('src/a.ts', 5)])]);
    const app = await appWith(llm);
    const { agentId } = await seedAgentWithCases(app);
    const first = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, first.id);
    const put = await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { system_prompt: 'prompt v2' } });
    expect(put.statusCode).toBe(200);
    const second = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, second.id);

    const runs = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun[];
    expect(runs.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(runs[0]!.agent_version).toBe(runs[1]!.agent_version + 1);
    expect(runs[0]!.prompt_sha).not.toBe(runs[1]!.prompt_sha);
    expect(llm.requests.at(-1)!.messages.map((m) => m.content).join('\n')).toContain('prompt v2');
    await app.close();
  });

  it('allows one running run per agent: a concurrent start is 409 (AC-11)', async () => {
    const slow = new ScriptedLLM([review([])], { delayMs: 800 });
    const app = await appWith(slow);
    const { agentId } = await seedAgentWithCases(app);
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` }),
      app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([202, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe('eval_run_in_progress');
    const winner = (a.statusCode === 202 ? a : b).json() as AgentEvalRun;
    await waitForRun(app, agentId, winner.id);
    await app.close();
  });

  it('an engine failure fails the run with null metrics and error case rows (AC-21)', async () => {
    const app = await appWith(new ScriptedLLM([new Error('provider 503')]));
    const { agentId } = await seedAgentWithCases(app);
    const started = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    const run = await waitForRun(app, agentId, started.id);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('provider 503');
    expect([run.recall, run.precision, run.citation_accuracy]).toEqual([null, null, null]);
    const rows = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, run.id));
    expect(rows.map((r) => r.outcome)).toEqual(['error', 'error', 'error']);
    await app.close();
  });

  it('a missing provider key fails before any run row is written (AC-12)', async () => {
    const app = await appWith(); // no openrouter override, empty secrets → ConfigError
    const { agentId } = await seedAgentWithCases(app);
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('config_error');
    expect(await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.agentId, agentId))).toHaveLength(0);
    await app.close();
  });

  it('rejects an agent without cases (422) and a foreign agent (404, AC-30)', async () => {
    const app = await appWith(new ScriptedLLM([review([])]));
    const [empty] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: `Empty ${randomUUID().slice(0, 6)}`, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    const none = await app.inject({ method: 'POST', url: `/agents/${empty!.id}/eval-runs` });
    expect(none.statusCode).toBe(422);
    expect(none.json().error.code).toBe('no_eval_cases');

    const [ws2] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID().slice(0, 4)}` }).returning();
    const [foreign] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign', provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    expect((await app.inject({ method: 'POST', url: `/agents/${foreign!.id}/eval-runs` })).statusCode).toBe(404);
    expect(await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.agentId, foreign!.id))).toHaveLength(0);
    await app.close();
  });

  it('the boot reaper fails runs left running by a dead process (AC-22)', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: `Reap ${randomUUID().slice(0, 6)}`, provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    const [orphan] = await pg.handle.db
      .insert(t.agentEvalRuns)
      .values({ workspaceId, agentId: agent!.id, agentVersion: 1, configSnapshot: {}, promptSha: 'x', status: 'running' })
      .returning();
    const app = await appWith(); // buildApp runs the boot reapers
    const [row] = await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.id, orphan!.id));
    expect(row!.status).toBe('failed');
    expect(row!.error).toContain('interrupted');
    expect(row!.finishedAt).not.toBeNull();
    await app.close();
  });

  // ---- Stage 6: run detail + comparison ------------------------------------------

  /** DB-side JSON of the eval tables (reads must leave them byte-identical). */
  async function evalSnapshot() {
    const sql = pg.handle.sql;
    const rows = async (table: string) =>
      (await sql.unsafe(`select to_jsonb(x) as j from ${table} x order by id`)).map((r) => JSON.stringify(r.j));
    return { runs: await rows('agent_eval_runs'), results: await rows('eval_runs'), cases: await rows('eval_cases') };
  }

  /** v1 finds only a.ts:5; v2 (prompt contains "prompt v2") finds a.ts:5 and a.ts:10. */
  const versionedLlm = () =>
    new ScriptedLLM([
      (req) =>
        req.messages.some((m) => m.content.includes('prompt v2'))
          ? review([finding('src/a.ts', 5), finding('src/a.ts', 10)])
          : review([finding('src/a.ts', 5)]),
    ]);

  let doneRunOfOtherAgent: string;

  it('GET /eval-runs/:id returns stored metrics, counts, per-case results and is read-only', async () => {
    const app = await appWith(versionedLlm());
    const { agentId } = await seedAgentWithCases(app);
    const started = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, started.id);
    doneRunOfOtherAgent = started.id;

    const before = await evalSnapshot();
    const res = await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail).toMatchObject({
      id: started.id,
      status: 'done',
      error: null,
      recall: 0.5,
      precision: 1,
      citation_accuracy: 1,
      counts: { tp: 1, fn: 1, fp: 0, kept: 1, cases_total: 3, cases_passed: 2 },
      config: { system_prompt: 'prompt v1', provider: 'openrouter', skills: [] },
    });
    expect(detail.results.map((r: { outcome: string; error: string | null }) => [r.outcome, r.error]).sort()).toEqual([
      ['fn', null],
      ['pass', null],
      ['tp', null],
    ]);
    await app.inject({ method: 'GET', url: `/eval-runs/${started.id}` });
    expect(await evalSnapshot()).toEqual(before); // reads never rewrite history
    await app.close();
  });

  it('compares two versions: metric deltas, prompt, model and skill changes, case flips (AC-25)', async () => {
    const app = await appWith(versionedLlm());
    const { agentId } = await seedAgentWithCases(app);
    const v1 = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, v1.id);

    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId, name: `skill-${randomUUID().slice(0, 6)}`, description: 'd', type: 'custom', source: 'manual', body: 'Always cite exact lines.' })
      .returning();
    expect((await app.inject({ method: 'PUT', url: `/agents/${agentId}/skills`, payload: { skills: [{ skill_id: skill!.id }] } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { system_prompt: 'prompt v2', model: 'm2' } })).statusCode).toBe(200);
    const v2 = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, v2.id);

    const before = await evalSnapshot();
    const res = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${v1.id}&head=${v2.id}` });
    expect(res.statusCode).toBe(200);
    const cmp = res.json();
    expect(cmp.prompt_changed).toBe(true);
    expect([cmp.base_prompt, cmp.head_prompt]).toEqual(['prompt v1', 'prompt v2']);
    expect(cmp.config_changes).toEqual(['model', 'skills']);
    expect(cmp.config.base.model).toBe('m');
    expect(cmp.config.head.model).toBe('m2');
    expect(cmp.config.head.agent_version).toBeGreaterThan(cmp.config.base.agent_version);
    expect(cmp.skill_changes).toEqual([{ id: skill!.id, name: skill!.name, change: 'added', base_version: null, head_version: 1 }]);
    expect(JSON.stringify(cmp)).not.toContain('Always cite exact lines.'); // no skill bodies in the comparison
    expect(cmp.delta.recall).toBeCloseTo(0.5); // 0.5 → 1.0
    expect(cmp.delta.precision).toBe(0);
    expect(cmp.same_case_set).toBe(true);
    expect(cmp.cases.map((c: { change: string }) => c.change).sort()).toEqual(['fixed', 'unchanged', 'unchanged']);
    expect(await evalSnapshot()).toEqual(before);

    // different agents → 422
    const other = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${doneRunOfOtherAgent}&head=${v2.id}` });
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('different_agents');
    await app.close();
  });

  it('keeps null metrics null in detail and compare (no must_find → recall null)', async () => {
    const app = await appWith(new ScriptedLLM([review([])]));
    const { agentId } = await seedAgentWithCases(app, [[20, 'dismiss']]);
    const a = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, a.id);
    const b = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, b.id);

    const detail = (await app.inject({ method: 'GET', url: `/eval-runs/${a.id}` })).json();
    expect([detail.recall, detail.precision, detail.citation_accuracy]).toEqual([null, null, null]);
    expect(detail.counts.cases_passed).toBe(1);
    const cmp = (await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${a.id}&head=${b.id}` })).json();
    expect(cmp.delta).toEqual({ recall: null, precision: null, citation_accuracy: null, cost_usd: 0 });
    expect(cmp.prompt_changed).toBe(false);
    expect(cmp.config_changes).toEqual([]);
    await app.close();
  });

  it('shows a failed run with its errors and refuses to compare it (409)', async () => {
    let calls = 0;
    const app = await appWith(new ScriptedLLM([() => (calls++ === 0 ? review([finding('src/a.ts', 5)]) : new Error('provider 503'))]));
    const { agentId } = await seedAgentWithCases(app);
    const ok = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, ok.id);
    const bad = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    await waitForRun(app, agentId, bad.id);

    const detail = (await app.inject({ method: 'GET', url: `/eval-runs/${bad.id}` })).json();
    expect(detail.status).toBe('failed');
    expect(detail.error).toContain('provider 503');
    expect([detail.recall, detail.precision, detail.citation_accuracy]).toEqual([null, null, null]);
    expect(detail.results.every((r: { outcome: string; error: string }) => r.outcome === 'error' && r.error.includes('provider 503'))).toBe(true);

    const res = await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${ok.id}&head=${bad.id}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'run_not_done', details: { runs: [{ id: bad.id, status: 'failed' }] } });
    await app.close();
  });

  it('isolates workspaces: a foreign run is 404 in detail and compare (AC-30)', async () => {
    const app = await appWith();
    const db = pg.handle.db;
    const [ws2] = await db.insert(t.workspaces).values({ name: `iso-${randomUUID().slice(0, 4)}` }).returning();
    const [agent2] = await db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign', provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    const [foreignRun] = await db
      .insert(t.agentEvalRuns)
      .values({ workspaceId: ws2!.id, agentId: agent2!.id, agentVersion: 1, configSnapshot: {}, promptSha: 'x', status: 'done' })
      .returning();
    expect((await app.inject({ method: 'GET', url: `/eval-runs/${foreignRun!.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${doneRunOfOtherAgent}&head=${foreignRun!.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval-runs/${randomUUID()}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/eval-runs/not-a-uuid' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/eval-runs/compare?base=${doneRunOfOtherAgent}` })).statusCode).toBe(422);
    await app.close();
  });

  // ---- D-1: long-running runs vs stale recovery -----------------------------------

  const hourAgo = () => new Date(Date.now() - 60 * 60_000);

  /** A second PR of the same agent → a second frozen input (different title → different input_hash). */
  async function addSecondInput(app: Awaited<ReturnType<typeof appWith>>, agentId: string) {
    const db = pg.handle.db;
    const name = `second-${randomUUID().slice(0, 8)}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: 6, title: 'Second frozen PR', author: 'dev', branch: 'b', base: 'main', headSha: 'h6' })
      .returning();
    const [rev] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, runId: null, kind: 'review', verdict: 'comment', summary: 's', score: 1, model: 'm' })
      .returning();
    const [f] = await db
      .insert(t.findings)
      .values({ reviewId: rev!.id, file: 'src/a.ts', startLine: 7, endLine: 7, severity: 'WARNING', category: 'bug', title: 'L7', rationale: 'r', confidence: 1 })
      .returning();
    await app.inject({ method: 'POST', url: `/findings/${f!.id}/accept` });
    expect((await app.inject({ method: 'POST', url: `/findings/${f!.id}/eval-case` })).statusCode).toBe(201);
  }

  it('never fails a run that is still executing, however old: a second start is 409 and only one run pays', async () => {
    const slow = new ScriptedLLM([review([finding('src/a.ts', 5)])], { delayMs: 1500 });
    const app = await appWith(slow);
    const { agentId } = await seedAgentWithCases(app);
    const first = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    // pretend the run has been executing for an hour (longer than EVAL_STALE_RUN_MINUTES)
    await pg.handle.db.update(t.agentEvalRuns).set({ startedAt: hourAgo() }).where(eq(t.agentEvalRuns.id, first.id));

    const second = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'eval_run_in_progress', details: { eval_run_id: first.id } });

    const done = await waitForRun(app, agentId, first.id);
    expect(done.status).toBe('done'); // not reaped as stale
    expect(slow.requests).toHaveLength(1); // no parallel paid run
    expect(await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.agentId, agentId))).toHaveLength(1);
    await app.close();
  });

  it('recovers an orphaned running run older than 30 min; a younger orphan still blocks', async () => {
    const app = await appWith(new ScriptedLLM([review([])]));
    const { agentId } = await seedAgentWithCases(app);
    // a `running` row that no process here executes (its process died without a restart)
    const [orphan] = await pg.handle.db
      .insert(t.agentEvalRuns)
      .values({ workspaceId, agentId, agentVersion: 1, configSnapshot: {}, promptSha: 'x', status: 'running', startedAt: new Date(Date.now() - 5 * 60_000) })
      .returning();

    // younger than the cutoff: still treated as in progress
    expect((await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).statusCode).toBe(409);

    // older than 30 min and not executing here: failed as stale, a new run starts
    await pg.handle.db.update(t.agentEvalRuns).set({ startedAt: hourAgo() }).where(eq(t.agentEvalRuns.id, orphan!.id));
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const [reaped] = await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.id, orphan!.id));
    expect(reaped!.status).toBe('failed');
    expect(reaped!.error).toContain('stale');
    expect((await waitForRun(app, agentId, res.json().id)).status).toBe('done');
    await app.close();
  });

  it('a run failed from outside stops before its next paid call', async () => {
    const slow = new ScriptedLLM([review([])], { delayMs: 800 });
    const app = await appWith(slow);
    const { agentId } = await seedAgentWithCases(app);
    await addSecondInput(app, agentId); // 2 frozen inputs → 2 engine calls when not stopped
    const started = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` })).json() as AgentEvalRun;
    // while the first call is in flight, the run is failed elsewhere (e.g. by another process's reaper)
    await new Promise((r) => setTimeout(r, 200));
    await pg.handle.db
      .update(t.agentEvalRuns)
      .set({ status: 'failed', error: 'reaped elsewhere', finishedAt: new Date() })
      .where(eq(t.agentEvalRuns.id, started.id));
    await new Promise((r) => setTimeout(r, 1500));
    expect(slow.requests).toHaveLength(1); // the second input was never sent
    const [row] = await pg.handle.db.select().from(t.agentEvalRuns).where(eq(t.agentEvalRuns.id, started.id));
    expect(row!.error).toBe('reaped elsewhere'); // the guarded finalize did not overwrite it
    expect(await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, started.id))).toHaveLength(0);
    await app.close();
  });
});
