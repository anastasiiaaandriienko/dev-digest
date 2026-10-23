import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AgentEstimate } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { addTrace, newAgent, newRepoAndPr, newRun, newWorkspace } from './helpers/multi-run-fixtures.js';

/**
 * L07 T12 — GET /multi-agent/estimates on a real Postgres (AC-MAR-19, 56): the
 * window function, the done/local filters and the workspace scope, which unit
 * tests could only check as SQL text. Disposable Testcontainers DB, no network.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const T = (ms: number) => new Date(Date.UTC(2026, 9, 23, 10) + ms);

d('Multi-agent estimates (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let db: PgFixture['handle']['db'];
  let ws: string;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [w] = await db.select().from(t.workspaces);
    ws = w!.id;
    app = await buildApp({
      config: config(),
      db,
      overrides: { secrets: new MockSecretsProvider({}), github: new MockGitHubClient({ pulls: [] }) },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const estimates = async (): Promise<Map<string, AgentEstimate>> => {
    const res = await app.inject({ method: 'GET', url: '/multi-agent/estimates' });
    expect(res.statusCode).toBe(200);
    return new Map((res.json() as AgentEstimate[]).map((e) => [e.agent_id, e]));
  };

  it('averages the last 10 done local runs; older, CI, unfinished and failed runs never count', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const a = await newAgent(db, ws, 'Windowed');
    // 2 old, slow and expensive runs, then 10 recent ones (1000 ms / $0.01).
    for (let i = 0; i < 12; i++) {
      const old = i < 2;
      const r = await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(i), durationMs: old ? 99_000 : 1000 });
      await addTrace(db, r.id, old ? 9.99 : 0.01);
    }
    // Newer than all of them, but excluded: CI, running, failed, cancelled.
    for (const [j, v] of ([
      ['ci', 'done'],
      ['local', 'running'],
      ['local', 'failed'],
      ['local', 'cancelled'],
    ] as const).entries()) {
      const r = await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(100 + j), source: v[0], status: v[1], durationMs: 500_000 });
      await addTrace(db, r.id, 50);
    }
    const e = (await estimates()).get(a.id)!;
    expect(e.runs).toBe(10);
    expect(e.avg_duration_ms).toBe(1000);
    expect(e.avg_cost_usd).toBeCloseTo(0.01, 10);
  });

  it('an agent without history is listed with runs 0 and null averages', async () => {
    const fresh = await newAgent(db, ws, 'Fresh');
    expect((await estimates()).get(fresh.id)).toEqual({ agent_id: fresh.id, runs: 0, avg_duration_ms: null, avg_cost_usd: null });
  });

  it('partially missing values: means over the known ones; a run with no trace has unknown cost', async () => {
    const { pr } = await newRepoAndPr(db, ws);
    const a = await newAgent(db, ws, 'Partial');
    const r1 = await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(1), durationMs: 1000 });
    await addTrace(db, r1.id, 0.04);
    const r2 = await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(2), durationMs: null });
    await addTrace(db, r2.id, null);
    await newRun(db, { workspaceId: ws, agentId: a.id, prId: pr.id, ranAt: T(3), durationMs: 3000 }); // no trace
    const e = (await estimates()).get(a.id)!;
    expect(e).toMatchObject({ runs: 3, avg_duration_ms: 2000 });
    expect(e.avg_cost_usd).toBeCloseTo(0.04, 10);
  });

  it('rows with a NULL pr_id still count (AC-MAR-56)', async () => {
    const a = await newAgent(db, ws, 'No PR');
    const r = await newRun(db, { workspaceId: ws, agentId: a.id, prId: null, ranAt: T(1), durationMs: 4200 });
    await addTrace(db, r.id, 0.02);
    expect((await estimates()).get(a.id)).toMatchObject({ runs: 1, avg_duration_ms: 4200, avg_cost_usd: 0.02 });
  });

  it('workspace isolation: other workspaces’ agents are not listed and their runs never count', async () => {
    const other = await newWorkspace(db);
    const foreign = await newAgent(db, other, 'Foreign');
    const { pr } = await newRepoAndPr(db, other);
    const r = await newRun(db, { workspaceId: other, agentId: foreign.id, prId: pr.id, durationMs: 777 });
    await addTrace(db, r.id, 7);
    const all = await estimates();
    expect(all.has(foreign.id)).toBe(false);
    const seeded = await db.select().from(t.agents);
    const mine = seeded.filter((x) => x.workspaceId === ws).map((x) => x.id).sort();
    expect([...all.keys()].sort()).toEqual(mine);
  });
});
