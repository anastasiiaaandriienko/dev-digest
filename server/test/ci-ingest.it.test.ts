import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { strToU8, zipSync } from 'fflate';
import type { CiResultArtifact, WorkflowRunMeta } from '@devdigest/shared';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { AppError } from '../src/platform/errors.js';
import { MockGitHubClient, type MockGitHubOptions } from '../src/adapters/mocks.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { CiSyncService, ManualSyncThrottle } from '../src/modules/ci/sync.js';
import { WORKFLOW_PATH } from '../src/modules/ci/constants.js';
import ciRoutes from '../src/modules/ci/routes.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

/**
 * L07 B7 — CI ingest & sync on a real Postgres with GitHub mocked
 * (specs/export-to-ci.md §7; AC-CI-40, 42..45, 49, 51, 55, 58, 82, 87, 93):
 * HTTP sync + list, repeated and concurrent syncs, status transitions, the
 * workflow-404 vs repository-404 rule and claim recovery. Routes are mounted
 * on a bare Fastify (not buildApp, whose boot reapers touch other rows).
 *
 * Database: Testcontainers (skipped without Docker) or DEVDIGEST_IT_DB_URL =
 * the isolated `devdigest_export_ci` (anything else fails). Every check is
 * scoped to this file's workspaces; at the end they are deleted and every row
 * id they owned is checked to be gone.
 */

const EXTERNAL_DB = 'devdigest_export_ci';
const externalUrl = process.env.DEVDIGEST_IT_DB_URL;
if (externalUrl && new URL(externalUrl).pathname !== `/${EXTERNAL_DB}`) {
  throw new Error(`DEVDIGEST_IT_DB_URL must point at the isolated "${EXTERNAL_DB}" database`);
}
const enabled = externalUrl ? true : await dockerAvailable();
const d = enabled ? describe : describe.skip;

const inList = (ids: readonly string[]) =>
  ids.length === 0 ? sql`(null)` : sql`(${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`;

const ARTIFACT: CiResultArtifact = {
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.01,
  duration_ms: 4200,
  agent: 'Security Reviewer',
  version: '1',
  pr_number: 7,
  model: 'openai/gpt-4.1',
  manifest_version: 3,
  gate_triggered: true,
  blockers: 1,
  skills: [],
};
const resultZip = (a: CiResultArtifact) => zipSync({ 'devdigest-result.json': strToU8(JSON.stringify(a)) });

d('CI ingest & sync (real Postgres, mocked GitHub)', () => {
  let pg: PgFixture | undefined;
  let handle: DbHandle;
  let db: Db;
  let app: FastifyInstance;
  let github: MockGitHubClient;
  const workspaces: string[] = [];

  beforeAll(async () => {
    if (externalUrl) handle = createDb(externalUrl, { max: 8 });
    else {
      pg = await startPg();
      handle = pg.handle;
    }
    db = handle.db;
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('container', {
      db,
      config: {},
      github: async () => github,
      auth: {
        currentUser: async () => ({ id: 'u', email: 'u@example.com', name: 'U' }),
        currentWorkspace: async (req: FastifyRequest) => ({ id: String(req.headers['x-workspace']), name: 'test' }),
      },
    } as never);
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) {
        reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
        return;
      }
      const status = (err as { statusCode?: number }).statusCode;
      reply.status(status && status < 500 ? 422 : 500).send({ error: { code: 'error' } });
    });
    await app.register(ciRoutes);
  });

  afterAll(async () => {
    await app?.close();
    if (!db) return;
    const w = inList(workspaces);
    const ids = async (q: ReturnType<typeof sql>) => (await db.execute<{ id: string }>(q)).map((r) => r.id);
    const owned = {
      agents: await ids(sql`select id from agents where workspace_id in ${w}`),
      repos: await ids(sql`select id from repos where workspace_id in ${w}`),
      pulls: await ids(sql`select id from pull_requests where workspace_id in ${w}`),
      installations: await ids(sql`select i.id from ci_installations i join agents a on a.id = i.agent_id where a.workspace_id in ${w}`),
      runs: await ids(sql`select id from agent_runs where workspace_id in ${w}`),
    };
    // no orphan parts of an ingested run
    const [orphans] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from agent_runs r where r.workspace_id in ${w} and r.source = 'ci'
           and not exists (select 1 from run_traces x where x.run_id = r.id)) as without_trace,
        (select count(*)::int from agent_runs r where r.workspace_id in ${w} and r.source = 'ci'
           and not exists (select 1 from ci_runs c where c.agent_run_id = r.id)) as without_ci_run`);
    expect(orphans).toEqual({ without_trace: 0, without_ci_run: 0 });
    if (workspaces.length > 0) await db.delete(t.workspaces).where(inArray(t.workspaces.id, workspaces));
    const [left] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from workspaces where id in ${w}) as workspaces,
        (select count(*)::int from agents where id in ${inList(owned.agents)}) as agents,
        (select count(*)::int from repos where id in ${inList(owned.repos)}) as repos,
        (select count(*)::int from pull_requests where id in ${inList(owned.pulls)}) as pulls,
        (select count(*)::int from ci_installations where id in ${inList(owned.installations)}) as installations,
        (select count(*)::int from agent_runs where id in ${inList(owned.runs)}) as runs,
        (select count(*)::int from run_traces where run_id in ${inList(owned.runs)}) as traces,
        (select count(*)::int from ci_runs where agent_run_id in ${inList(owned.runs)}
           or ci_installation_id in ${inList(owned.installations)}) as ci_runs`);
    expect(left).toEqual({ workspaces: 0, agents: 0, repos: 0, pulls: 0, installations: 0, runs: 0, traces: 0, ci_runs: 0 });
    if (externalUrl) await handle.close();
    else await pg?.stop();
  });

  /** A workspace with one agent installed (pending) on a fresh repo. */
  async function fixture(status: 'pending' | 'active' | 'error' = 'pending') {
    const [w] = await db.insert(t.workspaces).values({ name: `ci-it-${randomUUID()}` }).returning();
    workspaces.push(w!.id);
    const name = `widgets-${randomUUID().slice(0, 8)}`;
    const [repoRow] = await db.insert(t.repos).values({ workspaceId: w!.id, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId: w!.id, name: 'Security Reviewer', provider: 'openrouter', model: 'openai/gpt-4.1', systemPrompt: 'review' })
      .returning();
    const res = await new CiRepository(db).upsertInstallationExclusive({
      workspaceId: w!.id,
      agentId: agent!.id,
      repo: `acme/${name}`,
      targetType: 'gha',
      agentVersion: 3,
      prUrl: null,
    });
    if (!res.ok) throw new Error('unreachable');
    if (status !== 'pending') await new CiRepository(db).setStatus(res.installation.id, status);
    return { ws: w!.id, repo: `acme/${name}`, repoId: repoRow!.id, agent: agent!, installation: res.installation };
  }

  const run = (repo: string, id: number, over: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta => ({
    id,
    head_sha: `sha${id}`,
    repository_id: 42,
    repository_full_name: repo,
    head_repository_full_name: repo,
    path: WORKFLOW_PATH,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/${repo}/actions/runs/${id}`,
    pull_request_numbers: [7],
    run_started_at: new Date(Date.UTC(2026, 9, 23, 10, id % 60)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 9, 23, 10, id % 60, 30)).toISOString(),
    ...over,
  });

  /** Three runs: blocked (gate), passed, and a failed run without artifact. */
  function threeRuns(repo: string): MockGitHubOptions {
    return {
      workflowRuns: [run(repo, 3, { conclusion: 'failure' }), run(repo, 2), run(repo, 1, { conclusion: 'failure' })],
      runArtifacts: {
        1: [{ id: 11, name: 'devdigest-result', size_in_bytes: 300, expired: false }],
        2: [{ id: 22, name: 'devdigest-result', size_in_bytes: 300, expired: false }],
      },
      artifactZips: {
        11: resultZip(ARTIFACT),
        22: resultZip({ ...ARTIFACT, findings_count: 0, critical: 0, warning: 0, gate_triggered: false, blockers: 0 }),
      },
    };
  }

  const service = (opts: { intervalMs?: number; throttle?: ManualSyncThrottle } = {}) =>
    new CiSyncService({} as never, {
      repo: new CiRepository(db),
      github: async () => github,
      autoSyncIntervalMs: opts.intervalMs ?? 600_000,
      manualThrottle: opts.throttle ?? new ManualSyncThrottle(),
    });
  const ownedRows = async (ws: string) => {
    const [row] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from agent_runs where workspace_id = ${ws}::uuid and source = 'ci') as agent_runs,
        (select count(*)::int from run_traces x join agent_runs r on r.id = x.run_id where r.workspace_id = ${ws}::uuid) as run_traces,
        (select count(*)::int from ci_runs c join agent_runs r on r.id = c.agent_run_id where r.workspace_id = ${ws}::uuid) as ci_runs`);
    return row!;
  };
  const installationRow = async (id: string) =>
    (await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.id, id)))[0]!;
  const call = (ws: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { 'x-workspace': ws } });

  it('HTTP: a manual sync ingests the runs; GET /ci/runs lists them newest first with verdicts; installation active', async () => {
    const f = await fixture();
    github = new MockGitHubClient(threeRuns(f.repo));
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId: f.ws, repoId: f.repoId, number: 7, title: 'PR', author: 'a', branch: 'b', base: 'main', headSha: 'x', additions: 1, deletions: 0, filesCount: 1, status: 'open' })
      .returning();

    const res = await call(f.ws, 'POST', '/ci/runs/sync', { mode: 'manual' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ingested: 3, throttled: 0, skipped: [], errors: [] });

    const list = (await call(f.ws, 'GET', '/ci/runs')).json();
    expect(list.map((r: { commit_sha: string; verdict: string }) => [r.commit_sha, r.verdict])).toEqual([
      ['sha3', 'failed'],
      ['sha2', 'passed'],
      ['sha1', 'blocked'],
    ]);
    expect(list[2]).toMatchObject({ repo: f.repo, agent: 'Security Reviewer', pr_number: 7, findings_count: 2, cost_usd: 0.01, duration_s: 4.2, status: 'succeeded' });
    expect(list[0]).toMatchObject({ cost_usd: null, findings_count: null, status: 'failed' });
    expect((await installationRow(f.installation.id)).status).toBe('active');
    const [ar] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, list[2].agent_run_id));
    expect(ar).toMatchObject({ prId: pr!.id, source: 'ci', agentId: f.agent.id });

    expect((await call(f.ws, 'GET', `/ci/runs?agent_id=${f.agent.id}`)).json()).toHaveLength(3);
    expect((await call(f.ws, 'GET', `/ci/runs?repo=${encodeURIComponent('acme/other')}`)).json()).toEqual([]);
    const other = await fixture();
    expect((await call(other.ws, 'GET', '/ci/runs')).json()).toEqual([]);
    expect((await call(other.ws, 'POST', '/ci/runs/sync', { mode: 'manual', installation_id: f.installation.id })).statusCode).toBe(404);
    expect((await call(f.ws, 'POST', '/ci/runs/sync', { mode: 'sometimes' })).statusCode).toBe(422);
  });

  it('a repeated sync stores nothing twice (AC-CI-44)', async () => {
    const f = await fixture();
    github = new MockGitHubClient(threeRuns(f.repo));
    const s = service({ intervalMs: 0 });
    expect((await s.sync(f.ws, { mode: 'auto' })).ingested).toBe(3);
    expect((await s.sync(f.ws, { mode: 'auto' })).ingested).toBe(0);
    expect(await ownedRows(f.ws)).toEqual({ agent_runs: 3, run_traces: 3, ci_runs: 3 });
  });

  it('concurrent automatic syncs: one claims, the others are throttled; each run stored once (AC-CI-55)', async () => {
    const f = await fixture();
    github = new MockGitHubClient(threeRuns(f.repo));
    const s = service();
    const results = await Promise.all([s.sync(f.ws, { mode: 'auto' }), s.sync(f.ws, { mode: 'auto' }), s.sync(f.ws, { mode: 'auto' })]);
    expect(results.map((r) => r.ingested).sort()).toEqual([0, 0, 3]);
    expect(results.reduce((n, r) => n + r.throttled, 0)).toBe(2);
    expect(await ownedRows(f.ws)).toEqual({ agent_runs: 3, run_traces: 3, ci_runs: 3 });
  });

  it('concurrent manual syncs from two processes (separate throttles): the DB keeps one row per run', async () => {
    const f = await fixture();
    github = new MockGitHubClient(threeRuns(f.repo));
    const results = await Promise.all([
      service({ throttle: new ManualSyncThrottle() }).sync(f.ws, { mode: 'manual' }),
      service({ throttle: new ManualSyncThrottle() }).sync(f.ws, { mode: 'manual' }),
    ]);
    expect(results[0]!.ingested + results[1]!.ingested).toBe(3);
    expect(await ownedRows(f.ws)).toEqual({ agent_runs: 3, run_traces: 3, ci_runs: 3 });
    expect((await installationRow(f.installation.id)).lastSyncedAt).not.toBeNull();
  });

  it('pending + workflow 404 + readable repository → stays pending, no error, claim kept (AC-CI-93)', async () => {
    const f = await fixture('pending');
    github = new MockGitHubClient({ failWith: { listWorkflowRuns: 404 } });
    const res = await service().sync(f.ws, { mode: 'auto' });
    expect(res).toEqual({ ingested: 0, throttled: 0, skipped: [{ installation_id: f.installation.id, github_run_id: null, reason: 'workflow_not_published' }], errors: [] });
    const row = await installationRow(f.installation.id);
    expect(row.status).toBe('pending');
    expect(row.lastSyncedAt).not.toBeNull();
  });

  it('repository 404 → error (claim kept); the next successful ingest makes it active again (AC-CI-58, A8)', async () => {
    const f = await fixture('pending');
    github = new MockGitHubClient({ failWith: { listWorkflowRuns: 404, getDefaultBranch: 404 } });
    const res = await service().sync(f.ws, { mode: 'auto' });
    expect(res.errors).toHaveLength(1);
    let row = await installationRow(f.installation.id);
    expect(row.status).toBe('error');
    expect(row.lastSyncedAt).not.toBeNull();

    github = new MockGitHubClient(threeRuns(f.repo));
    expect((await service().sync(f.ws, { mode: 'auto' })).throttled).toBe(1); // 10-minute back-off
    expect((await service().sync(f.ws, { mode: 'manual' })).ingested).toBe(3);
    row = await installationRow(f.installation.id);
    expect(row.status).toBe('active');
  });

  it('a transient failure puts last_synced_at back, so the next page open retries (AC-CI-87)', async () => {
    const f = await fixture('active');
    github = new MockGitHubClient({ failWith: { listWorkflowRuns: 503 } });
    const res = await service().sync(f.ws, { mode: 'auto' });
    expect(res.errors[0]!.message).toContain('HTTP 503');
    const row = await installationRow(f.installation.id);
    expect(row.status).toBe('active');
    expect(row.lastSyncedAt).toBeNull();
    github = new MockGitHubClient(threeRuns(f.repo));
    expect((await service().sync(f.ws, { mode: 'auto' })).ingested).toBe(3);
  });
});
