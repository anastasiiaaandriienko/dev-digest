import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { addReview, addTrace, finding, newAgent, newRepoAndPr, newRun, newWorkspace } from './helpers/multi-run-fixtures.js';

/**
 * L07 T12 — DELETE /runs/:id guard (AC-MAR-59, spec S8) on a real Postgres:
 * a CI run is refused with 409 and its run, trace, review, findings,
 * ci_installations and ci_runs rows stay byte-for-byte; a local run is still
 * deleted exactly as before. Disposable Testcontainers DB, no network.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('CI run delete guard (Testcontainers pg)', () => {
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

  /** A run with its trace, a review with one finding — and, for CI, an installation + ci_runs row. */
  async function seedRun(workspaceId: string, source: 'local' | 'ci') {
    const { pr } = await newRepoAndPr(db, workspaceId);
    const agent = await newAgent(db, workspaceId);
    const run = await newRun(db, { workspaceId, agentId: agent.id, prId: pr.id, source });
    await addTrace(db, run.id, 0.02);
    const { review } = await addReview(db, { workspaceId, prId: pr.id, agentId: agent.id, runId: run.id }, [
      finding({ file: 'src/a.ts', start_line: 3, severity: 'CRITICAL' }),
    ]);
    let ciRunId: string | null = null;
    if (source === 'ci') {
      const [inst] = await db
        .insert(t.ciInstallations)
        .values({ agentId: agent.id, repo: 'acme/widgets', targetType: 'gha', status: 'active' })
        .returning();
      const [ciRun] = await db
        .insert(t.ciRuns)
        .values({
          ciInstallationId: inst!.id,
          agentRunId: run.id,
          prNumber: 482,
          status: 'succeeded',
          findingsCount: 1,
          githubRunId: 123456789012,
          githubRepoId: 42,
          commitSha: 'a1b2c3d4',
        })
        .returning();
      ciRunId = ciRun!.id;
    }
    return { runId: run.id, reviewId: review.id, ciRunId };
  }

  /** Every related row as DB-side JSON (independent of driver parsing). */
  async function snapshot(runId: string, reviewId: string) {
    const q = (text: ReturnType<typeof sql>) => db.execute(text);
    return {
      run: await q(sql`select to_jsonb(r) j from agent_runs r where id = ${runId}`),
      trace: await q(sql`select to_jsonb(x) j from run_traces x where run_id = ${runId}`),
      review: await q(sql`select to_jsonb(x) j from reviews x where id = ${reviewId}`),
      findings: await q(sql`select to_jsonb(x) j from findings x where review_id = ${reviewId} order by id`),
      ciRuns: await q(sql`select to_jsonb(x) j from ci_runs x where agent_run_id = ${runId}`),
      installations: await q(
        sql`select to_jsonb(i) j from ci_installations i join ci_runs c on c.ci_installation_id = i.id where c.agent_run_id = ${runId}`,
      ),
    };
  }

  it('a CI run → 409 ci_run_not_deletable; run, trace, review, findings, ci_runs and installation unchanged', async () => {
    const { runId, reviewId, ciRunId } = await seedRun(ws, 'ci');
    const before = await snapshot(runId, reviewId);
    expect(before.ciRuns).toHaveLength(1);
    expect(before.installations).toHaveLength(1);

    const res = await app.inject({ method: 'DELETE', url: `/runs/${runId}` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ci_run_not_deletable');

    expect(await snapshot(runId, reviewId)).toEqual(before);
    expect((await db.select().from(t.ciRuns).where(eq(t.ciRuns.id, ciRunId!)))).toHaveLength(1);
  });

  it('a local run is deleted exactly as before: { ok: true }, run + trace + review + findings gone', async () => {
    const { runId, reviewId } = await seedRun(ws, 'local');
    const res = await app.inject({ method: 'DELETE', url: `/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const after = await snapshot(runId, reviewId);
    expect([after.run, after.trace, after.review, after.findings].map((r) => r.length)).toEqual([0, 0, 0, 0]);
  });

  it('a CI run of another workspace reads as missing: { ok: false }, no 409, nothing deleted', async () => {
    const other = await newWorkspace(db);
    const { runId, reviewId } = await seedRun(other, 'ci');
    const before = await snapshot(runId, reviewId);
    const res = await app.inject({ method: 'DELETE', url: `/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false });
    expect(await snapshot(runId, reviewId)).toEqual(before);
  });

  it('a non-existent run → { ok: false }', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/runs/00000000-0000-4000-8000-0000000000ff' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false });
  });
});
