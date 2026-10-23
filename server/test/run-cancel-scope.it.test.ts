import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import reviewsRoutes from '../src/modules/reviews/routes.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { newAgent, newMultiRun, newRepoAndPr, newRun } from './helpers/multi-run-fixtures.js';

/**
 * L07 B15 — POST /runs/:id/cancel on a real Postgres: a running local run of
 * the caller's workspace is cancelled ({ ok: true }) while its multi-agent
 * sibling keeps running; a run of another workspace, a missing run and a CI run
 * answer { ok: false } and their rows are unchanged. The real reviews routes are
 * mounted on a bare Fastify (not buildApp, whose boot reapers touch other rows),
 * with the workspace taken from a test header.
 *
 * Database: Testcontainers (skipped without Docker) or DEVDIGEST_IT_DB_URL =
 * the isolated `devdigest_export_ci` (anything else fails). Every row lives in
 * this file's workspaces, which are deleted at the end.
 */

const EXTERNAL_DB = 'devdigest_export_ci';
const externalUrl = process.env.DEVDIGEST_IT_DB_URL;
if (externalUrl && new URL(externalUrl).pathname !== `/${EXTERNAL_DB}`) {
  throw new Error(`DEVDIGEST_IT_DB_URL must point at the isolated "${EXTERNAL_DB}" database`);
}
const enabled = externalUrl ? true : await dockerAvailable();
const d = enabled ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('POST /runs/:id/cancel — workspace scope (real Postgres)', () => {
  let pg: PgFixture | undefined;
  let handle: DbHandle;
  let db: Db;
  let app: FastifyInstance;
  const workspaces: string[] = [];

  beforeAll(async () => {
    if (externalUrl) handle = createDb(externalUrl, { max: 4 });
    else {
      pg = await startPg();
      handle = pg.handle;
    }
    db = handle.db;
    const container = new Container(config(), db, {
      secrets: new MockSecretsProvider({}),
      auth: {
        currentUser: async () => ({ id: 'u', email: 'u@example.com', name: 'U' }),
        currentWorkspace: async (req: FastifyRequest) => ({ id: String(req.headers['x-workspace']), name: 'test' }),
      } as never,
    });
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('container', container);
    await app.register(reviewsRoutes);
  });

  afterAll(async () => {
    await app?.close();
    if (!db) return;
    if (workspaces.length > 0) await db.delete(t.workspaces).where(inArray(t.workspaces.id, workspaces));
    const [left] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where workspace_id in (${sql.join(
        workspaces.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    expect(left!.n).toBe(0);
    if (externalUrl) await handle.close();
    else await pg?.stop();
  });

  async function workspace() {
    const [w] = await db.insert(t.workspaces).values({ name: `cancel-it-${randomUUID()}` }).returning();
    workspaces.push(w!.id);
    const { pr } = await newRepoAndPr(db, w!.id);
    const agent = await newAgent(db, w!.id);
    return { ws: w!.id, prId: pr.id, agentId: agent.id };
  }

  const cancel = async (ws: string, runId: string) => {
    const res = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, headers: { 'x-workspace': ws } });
    expect(res.statusCode).toBe(200);
    return res.json() as { ok: boolean };
  };
  const statusOf = async (runId: string) =>
    (await db.select({ status: t.agentRuns.status }).from(t.agentRuns).where(eq(t.agentRuns.id, runId)))[0]?.status;

  it('own running run → { ok: true } and cancelled; its multi-agent sibling keeps running', async () => {
    const a = await workspace();
    const multi = await newMultiRun(db, a.ws, a.prId);
    const run = await newRun(db, { workspaceId: a.ws, agentId: a.agentId, prId: a.prId, status: 'running', multiAgentRunId: multi.id });
    const sibling = await newRun(db, { workspaceId: a.ws, agentId: a.agentId, prId: a.prId, status: 'running', multiAgentRunId: multi.id });

    expect(await cancel(a.ws, run.id)).toEqual({ ok: true });
    expect(await statusOf(run.id)).toBe('cancelled');
    expect(await statusOf(sibling.id)).toBe('running');
  });

  it("another workspace's running run → { ok: false } and its row is unchanged", async () => {
    const a = await workspace();
    const b = await workspace();
    const foreign = await newRun(db, { workspaceId: b.ws, agentId: b.agentId, prId: b.prId, status: 'running' });

    expect(await cancel(a.ws, foreign.id)).toEqual({ ok: false });
    expect(await statusOf(foreign.id)).toBe('running');
    // Its own workspace can still cancel it.
    expect(await cancel(b.ws, foreign.id)).toEqual({ ok: true });
    expect(await statusOf(foreign.id)).toBe('cancelled');
  });

  it('a non-existent run → { ok: false }', async () => {
    const a = await workspace();
    expect(await cancel(a.ws, randomUUID())).toEqual({ ok: false });
  });

  it('a CI run → { ok: false } and its row is unchanged', async () => {
    const a = await workspace();
    const ci = await newRun(db, { workspaceId: a.ws, agentId: a.agentId, prId: a.prId, status: 'done', source: 'ci' });

    expect(await cancel(a.ws, ci.id)).toEqual({ ok: false });
    expect(await statusOf(ci.id)).toBe('done');
  });
});
