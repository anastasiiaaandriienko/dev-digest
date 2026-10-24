import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import type { MultiAgentRun, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { MultiRunRepository } from '../src/modules/reviews/multi-run/repository.js';
import { DIFF, REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';
import { addReview, finding, newAgent, newMultiRun, newRepoAndPr, newRun, newWorkspace } from './helpers/multi-run-fixtures.js';

/**
 * L07 T12 — multi-agent runs against a disposable Testcontainers Postgres with
 * every migration (incl. 0016) applied. LLM, git, GitHub and secrets are mocks;
 * nothing reaches a working database. AC-MAR-01..04, 09..11, 15, 16, 53..57.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const QUIET: Review = { verdict: 'approve', summary: 'Looks fine.', score: 95, findings: [] };
const PERF: Review = {
  verdict: 'comment',
  summary: 'Config smell.',
  score: 70,
  findings: [{ ...REVIEW_FIXTURE.findings[0]!, id: 'f-perf', severity: 'WARNING', title: 'Secret read on every request' }],
};
const REVIEW_BY_MODEL: Record<string, Review> = { 'm-sec': REVIEW_FIXTURE, 'm-perf': PERF, 'm-quiet': QUIET };

/** Answers per agent model, so agents disagree deterministically. No network. */
class RoutedLLM extends MockLLMProvider {
  private byModel = new Map(
    Object.entries(REVIEW_BY_MODEL).map(([m, r]) => [m, new MockLLMProvider('openai', { structured: r })]),
  );
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const llm = this.byModel.get(req.model) ?? new MockLLMProvider('openai', { structured: QUIET });
    return llm.completeStructured(req);
  }
}

d('Multi-agent runs (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let ws: string;
  let db: PgFixture['handle']['db'];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [w] = await db.select().from(t.workspaces);
    ws = w!.id;
    app = await buildApp({
      config: config(),
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient({ pulls: [] }),
        git: new MockGitClient({ diff: DIFF }),
        embedder: new MockEmbedder(),
        llm: { openai: new RoutedLLM() },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const parentsFor = async (prId: string) =>
    (await db.select({ n: count() }).from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, prId)))[0]!.n;
  const runsFor = async (prId: string) => db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
  const readMulti = async (prId: string) => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/multi-agent` });
    return { status: res.statusCode, body: res.json() as { multi_run: MultiAgentRun | null } };
  };

  it('AC-01/53: agentIds → one parent + linked children in list order (duplicates dropped), then columns, groups and conflicts', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const sec = await newAgent(db, ws, 'Security', 'm-sec');
    const perf = await newAgent(db, ws, 'Performance', 'm-perf');
    const quiet = await newAgent(db, ws, 'Quiet', 'm-quiet');
    const order = [perf.id, sec.id, quiet.id];

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [perf.id, sec.id, perf.id, quiet.id] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.multi_agent_run_id).toEqual(expect.any(String));
    expect(body.runs.map((r: { agent_id: string }) => r.agent_id)).toEqual(order);

    // Persistence: exactly one parent, three children linked to it, ran_at in list order.
    const [parent] = await db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, pr.id));
    expect(parent!.id).toBe(body.multi_agent_run_id);
    const children = await runsFor(pr.id);
    expect(children).toHaveLength(3);
    expect(children.every((c) => c.multiAgentRunId === parent!.id && c.source === 'local')).toBe(true);
    const byRanAt = [...children].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
    expect(byRanAt.map((c) => c.agentId)).toEqual(order);
    expect(new Set(children.map((c) => c.ranAt.getTime())).size).toBe(3); // no ties (A-T1)

    const settled = await waitForPrRuns(db, pr.id, { expected: 3, timeoutMs: 20_000 });
    expect(settled.map((r) => r.status)).toEqual(['done', 'done', 'done']);

    const { status, body: read } = await readMulti(pr.id);
    expect(status).toBe(200);
    const run = read.multi_run!;
    expect(run.id).toBe(parent!.id);
    expect(run.pr_number).toBe(482);
    expect(run.columns.map((c) => c.agent_name)).toEqual(['Performance', 'Security', 'Quiet']);
    expect(run.columns.map((c) => c.status)).toEqual(['done', 'done', 'done']);
    expect(run.columns[1]!.findings.map((f) => [f.severity, f.file, f.start_line])).toEqual([['CRITICAL', 'src/config.ts', 11]]);
    // One group on the same line from two agents, attribution kept.
    expect(run.groups).toHaveLength(1);
    expect(run.groups[0]!.members.map((m) => [m.agent_name, m.severity])).toEqual([
      ['Performance', 'WARNING'],
      ['Security', 'CRITICAL'],
    ]);
    // Conflict: severities differ AND Quiet did not flag it (AC-15); takes per column (AC-16).
    expect(run.conflicts).toHaveLength(1);
    expect(run.conflicts[0]!.takes.map((tk) => [tk.persona, tk.verdict, tk.note])).toEqual([
      ['Performance', 'WARNING', 'Secret read on every request'],
      ['Security', 'CRITICAL', 'Hardcoded Stripe secret key'],
      ['Quiet', 'ignored', ''],
    ]);
    expect(run.agent_count).toBe(3);
    expect(run.wall_clock_ms).toEqual(expect.any(Number));
  });

  it('AC-03: empty, more than 8 distinct ids, or mixed bodies → 400 and no rows', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const a = await newAgent(db, ws);
    const nine = Array.from({ length: 9 }, () => randomUUID());
    for (const payload of [{ agentIds: [] }, { agentIds: nine }, { agentIds: [a.id], agentId: a.id }, { agentIds: [a.id], all: true }]) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_run_request');
    }
    expect(await parentsFor(pr.id)).toBe(0);
    expect(await runsFor(pr.id)).toHaveLength(0);
  });

  it('8 distinct agents (with duplicates) is accepted — the upper bound', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const agents = await Promise.all(Array.from({ length: 8 }, (_, i) => newAgent(db, ws, `Max ${i}`, 'm-quiet')));
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [...agents.map((x) => x.id), agents[0]!.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toHaveLength(8);
    await waitForPrRuns(db, pr.id, { expected: 8, timeoutMs: 30_000 });
  });

  it('AC-02: an agent of another workspace (or a malformed id) → 404 and no rows', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const mine = await newAgent(db, ws);
    const other = await newWorkspace(db);
    const foreign = await newAgent(db, other);
    for (const agentIds of [[mine.id, foreign.id], [mine.id, 'not-a-uuid']]) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentIds } });
      expect(res.statusCode).toBe(404);
    }
    expect(await parentsFor(pr.id)).toBe(0);
    expect(await runsFor(pr.id)).toHaveLength(0);
  });

  it('AC-04: the legacy {agentId} path creates no parent and leaves the link NULL', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const a = await newAgent(db, ws, 'Legacy', 'm-quiet');
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: a.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json().multi_agent_run_id).toBeNull();
    await waitForPrRuns(db, pr.id, { expected: 1 });
    expect(await parentsFor(pr.id)).toBe(0);
    expect((await runsFor(pr.id))[0]!.multiAgentRunId).toBeNull();
    expect((await readMulti(pr.id)).body).toEqual({ multi_run: null });
  });

  it('atomicity: a failing child insert rolls back the parent and every child', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const ok = await newAgent(db, ws);
    const repo = new MultiRunRepository(db);
    // The second agent id does not exist → FK violation on the child insert.
    await expect(
      repo.createMultiRun({
        workspaceId: ws,
        prId: pr.id,
        agents: [
          { id: ok.id, provider: 'openai', model: 'm' },
          { id: randomUUID(), provider: 'openai', model: 'm' },
        ],
      }),
    ).rejects.toThrow();
    expect(await parentsFor(pr.id)).toBe(0);
    expect(await runsFor(pr.id)).toHaveLength(0);
  });

  it('AC-16/54: ignored (done, not flagged) and no_result (running / failed) stay distinct; partial multi-run', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const [a, b, c, e] = await Promise.all(['A', 'B', 'C', 'E'].map((n) => newAgent(db, ws, `Agent ${n}`)));
    const m = await newMultiRun(db, ws, pr.id, T(0));
    const ra = await newRun(db, { workspaceId: ws, agentId: a!.id, prId: pr.id, multiAgentRunId: m.id, ranAt: T(1) });
    const rb = await newRun(db, { workspaceId: ws, agentId: b!.id, prId: pr.id, multiAgentRunId: m.id, ranAt: T(2) });
    await newRun(db, { workspaceId: ws, agentId: c!.id, prId: pr.id, multiAgentRunId: m.id, ranAt: T(3), status: 'running', durationMs: null });
    await newRun(db, { workspaceId: ws, agentId: e!.id, prId: pr.id, multiAgentRunId: m.id, ranAt: T(4), status: 'failed', error: 'provider down' });
    await addReview(db, { workspaceId: ws, prId: pr.id, agentId: a!.id, runId: ra.id }, [
      finding({ file: 'a.ts', start_line: 5, severity: 'CRITICAL', title: 'Injection' }),
    ]);
    await addReview(db, { workspaceId: ws, prId: pr.id, agentId: b!.id, runId: rb.id }, []);

    const run = (await readMulti(pr.id)).body.multi_run!;
    expect(run.columns.map((col) => col.status)).toEqual(['done', 'done', 'running', 'failed']);
    expect(run.columns[3]!.error).toBe('provider down');
    expect(run.conflicts).toHaveLength(1);
    expect(run.conflicts[0]!.takes.map((tk) => [tk.verdict, tk.note])).toEqual([
      ['CRITICAL', 'Injection'],
      ['ignored', ''],
      ['no_result', ''],
      ['no_result', ''],
    ]);
  });

  it('AC-11/55/56: workspace isolation; unlinked and CI rows never appear in a multi-run', async () => {
    const other = await newWorkspace(db);
    const { pr: foreignPr } = await newRepoAndPr(db, other);
    await newMultiRun(db, other, foreignPr.id);
    expect((await readMulti(foreignPr.id)).status).toBe(404);

    const { pr } = await newRepoAndPr(db, ws);
    const a = await newAgent(db, ws);
    const m = await newMultiRun(db, ws, pr.id, T(0));
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, multiAgentRunId: m.id, ranAt: T(1) });
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(2) }); // unlinked local
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(3), source: 'ci' }); // CI
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: null, ranAt: T(4) }); // pr_id NULL
    const run = (await readMulti(pr.id)).body.multi_run!;
    expect(run.columns).toHaveLength(1);
  });

  it('AC-09/10/57: the latest multi-run is returned; none → null; a deleted child drops out', async () => {
    const { pr: none } = await newRepoAndPr(db, ws);
    expect((await readMulti(none.id)).body).toEqual({ multi_run: null });

    const { pr } = await newRepoAndPr(db, ws);
    const [a, b] = await Promise.all([newAgent(db, ws, 'First'), newAgent(db, ws, 'Second')]);
    const older = await newMultiRun(db, ws, pr.id, T(0));
    const newer = await newMultiRun(db, ws, pr.id, T(100));
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, multiAgentRunId: older.id, ranAt: T(1) });
    const ra = await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, multiAgentRunId: newer.id, ranAt: T(101) });
    await newRun(db, { workspaceId: ws, agentId: b.id, prId: pr.id, multiAgentRunId: newer.id, ranAt: T(102) });

    let run = (await readMulti(pr.id)).body.multi_run!;
    expect(run.id).toBe(newer.id);
    expect(run.columns.map((col) => col.agent_name)).toEqual(['First', 'Second']);

    const del = await app.inject({ method: 'DELETE', url: `/runs/${ra.id}` });
    expect(del.json()).toEqual({ ok: true });
    run = (await readMulti(pr.id)).body.multi_run!;
    expect(run.columns.map((col) => col.agent_name)).toEqual(['Second']);
    expect(run.agent_count).toBe(1);
  });

  it('reads never write', async () => {
    const before = await Promise.all([
      db.select({ n: count() }).from(t.agentRuns),
      db.select({ n: count() }).from(t.multiAgentRuns),
      db.select({ n: count() }).from(t.findings),
    ]);
    const { pr } = await newRepoAndPr(db, ws);
    await readMulti(pr.id);
    const after = await Promise.all([
      db.select({ n: count() }).from(t.agentRuns),
      db.select({ n: count() }).from(t.multiAgentRuns),
      db.select({ n: count() }).from(t.findings),
    ]);
    expect(after.map((r) => r[0]!.n)).toEqual(before.map((r) => r[0]!.n));
  });
});

/** Fixed, strictly ordered timestamps (ms offsets). */
function T(ms: number): Date {
  return new Date(Date.UTC(2026, 9, 23, 10, 0, 0, 0) + ms);
}
