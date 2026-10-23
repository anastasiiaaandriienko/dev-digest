import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { unzipSync, strFromU8 } from 'fflate';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { AppError } from '../src/platform/errors.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import ciRoutes from '../src/modules/ci/routes.js';
import { CI_BRANCH, RUNNER_PACKAGE_JSON_PATH } from '../src/modules/ci/constants.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

/**
 * L07 B6 — Export-to-CI routes + CiService + the real CiRepository on a real
 * Postgres, GitHub mocked (specs/export-to-ci.md §6.1, §8; AC-CI-30..33, 36,
 * 37, 39, 86, 89, 91). The ci routes are mounted on a bare Fastify with the
 * container pieces they use — not buildApp, whose boot-time reapers would
 * update rows outside this test's workspaces. The error handler mirrors
 * app.ts (AppError → { error: { code, message, details } }).
 *
 * Database: a disposable Testcontainers Postgres (skipped without Docker), or
 * DEVDIGEST_IT_DB_URL pointing at the isolated, migrated `devdigest_export_ci`
 * (anything else fails); the test then only touches workspaces it creates,
 * deletes them and checks every touched table is back to its row count.
 */

const EXTERNAL_DB = 'devdigest_export_ci';
const externalUrl = process.env.DEVDIGEST_IT_DB_URL;
if (externalUrl && new URL(externalUrl).pathname !== `/${EXTERNAL_DB}`) {
  throw new Error(`DEVDIGEST_IT_DB_URL must point at the isolated "${EXTERNAL_DB}" database`);
}
const enabled = externalUrl ? true : await dockerAvailable();
const d = enabled ? describe : describe.skip;

const TABLES = ['workspaces', 'agents', 'repos', 'ci_installations', 'ci_runs', 'agent_runs'] as const;
const SECRET = 'sk-or-it-SECRET-VALUE';

d('Export to CI API (real Postgres, mocked GitHub)', () => {
  let pg: PgFixture | undefined;
  let handle: DbHandle;
  let db: Db;
  let app: FastifyInstance;
  let bundleDir: string;
  let github: MockGitHubClient;
  const workspaces: string[] = [];
  let countsBefore: Record<string, number> = {};

  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
      out[table] = row!.n;
    }
    return out;
  };

  beforeAll(async () => {
    if (externalUrl) {
      handle = createDb(externalUrl, { max: 6 });
    } else {
      pg = await startPg();
      handle = pg.handle;
    }
    db = handle.db;
    countsBefore = await counts();

    bundleDir = mkdtempSync(join(tmpdir(), 'devdigest-ci-it-'));
    const bundlePath = join(bundleDir, 'index.js');
    writeFileSync(bundlePath, '/* runner bundle */ export {};\n');
    process.env.OPENROUTER_API_KEY = SECRET;

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('container', {
      db,
      config: { ...loadConfig({ NODE_ENV: 'test' }), ciRunnerBundlePath: bundlePath },
      agentsRepo: new AgentsRepository(db),
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
      reply.status(status && status < 500 ? 422 : 500).send({ error: { code: status && status < 500 ? 'validation_error' : 'internal_error' } });
    });
    await app.register(ciRoutes);
  });

  afterAll(async () => {
    delete process.env.OPENROUTER_API_KEY;
    await app?.close();
    if (bundleDir) rmSync(bundleDir, { recursive: true, force: true });
    if (!db) return;
    if (workspaces.length > 0) await db.delete(t.workspaces).where(inArray(t.workspaces.id, workspaces));
    if (externalUrl) {
      expect(await counts()).toEqual(countsBefore);
      await handle.close();
    } else {
      await pg?.stop();
    }
  });

  async function fixture(baseTree: Record<string, string> = { 'README.md': '# x' }) {
    const [w] = await db.insert(t.workspaces).values({ name: `ci-it-${randomUUID()}` }).returning();
    workspaces.push(w!.id);
    const name = `widgets-${randomUUID().slice(0, 8)}`;
    await db.insert(t.repos).values({ workspaceId: w!.id, owner: 'acme', name, fullName: `acme/${name}` });
    const mk = async (agentName: string) =>
      (
        await db
          .insert(t.agents)
          .values({ workspaceId: w!.id, name: agentName, provider: 'openrouter', model: 'openai/gpt-4.1', systemPrompt: 'review' })
          .returning()
      )[0]!;
    github = new MockGitHubClient({ defaultBranch: 'main', branches: { main: 'b0' }, trees: { b0: baseTree } });
    return { ws: w!.id, repo: `acme/${name}`, agent: await mk('Security Reviewer'), other: await mk('Perf Reviewer') };
  }

  const call = (ws: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { 'x-workspace': ws } });

  it('preview returns the file set and writes neither GitHub nor the DB', async () => {
    const f = await fixture();
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/ci/preview`, { repo: f.repo });
    expect(res.statusCode).toBe(200);
    expect(res.json().files.map((x: { path: string }) => x.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/runner/index.js',
      RUNNER_PACKAGE_JSON_PATH,
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(github.casCommits).toEqual([]);
    expect(await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, f.agent.id))).toEqual([]);
  });

  it('export → PR + pending installation; the lists show it in this workspace only (AC-CI-30, 32, 86)', async () => {
    const f = await fixture();
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ pr_url: 'https://github.com/mock/mock/pull/1', installation: { agent_id: f.agent.id, repo: f.repo, status: 'pending', target_type: 'gha' } });
    expect(github.branches[CI_BRANCH]).toBe('mock-commit-1');
    expect(res.body).not.toContain(SECRET);

    const mine = await call(f.ws, 'GET', `/agents/${f.agent.id}/ci/installations`);
    expect(mine.json()).toEqual([expect.objectContaining({ id: body.installation.id, agent_name: 'Security Reviewer', last_run_status: null })]);
    const byRepo = await call(f.ws, 'GET', `/ci/installations?repo=${encodeURIComponent(f.repo)}`);
    expect(byRepo.json().map((x: { agent_id: string }) => x.agent_id)).toEqual([f.agent.id]);

    const other = await fixture();
    expect((await call(other.ws, 'GET', `/ci/installations?repo=${encodeURIComponent(f.repo)}`)).json()).toEqual([]);
    expect((await call(other.ws, 'GET', `/agents/${f.agent.id}/ci/installations`)).statusCode).toBe(404);
    expect((await call(other.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo })).statusCode).toBe(404);
  });

  it('re-export of the same agent updates the one row and reuses the PR (AC-CI-36)', async () => {
    const f = await fixture();
    const first = (await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo })).json();
    await db.update(t.agents).set({ name: 'Renamed', version: 2 }).where(eq(t.agents.id, f.agent.id));
    const second = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ installation: { id: first.installation.id, agent_version: 2 } });
    expect(second.json().files[0].path).toBe('.devdigest/agents/security-reviewer.yaml');
    expect(github.openedPrs).toHaveLength(1);
    expect(await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, f.agent.id))).toHaveLength(1);
  });

  it('zip → application/zip with the runner package.json; pending row, no PR url (AC-CI-17, 39)', async () => {
    const f = await fixture();
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci/zip`, { repo: f.repo });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="devdigest-ci-security-reviewer.zip"');
    const entries = unzipSync(new Uint8Array(res.rawPayload));
    expect(strFromU8(entries[RUNNER_PACKAGE_JSON_PATH]!)).toBe('{"type":"module"}\n');
    expect(Object.values(entries).some((b) => strFromU8(b).includes(SECRET))).toBe(false);
    expect(github.casCommits).toEqual([]);
    const [row] = await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, f.agent.id));
    expect(row).toMatchObject({ status: 'pending', prUrl: null });
  });

  it('two agents exporting to one repo at once: one 200, one 409 ci_repo_has_agent; one row (AC-CI-37)', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo }),
      call(f.ws, 'POST', `/agents/${f.other.id}/export-ci`, { repo: f.repo }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const conflict = (a.statusCode === 409 ? a : b).json();
    expect(conflict.error.code).toBe('ci_repo_has_agent');
    expect(github.casCommits).toHaveLength(1);
    expect(await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.repo, f.repo))).toHaveLength(1);
  });

  it('a foreign manifest → 409 ci_manifest_conflict envelope; a moved branch → 409 ci_concurrent_change; no row (AC-CI-89, 91)', async () => {
    const f = await fixture({ '.devdigest/agents/x.yaml': JSON.stringify({ name: 'x', agent_id: randomUUID(), model: 'm', system_prompt: 'p' }) });
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'ci_manifest_conflict', details: { paths: ['.devdigest/agents/x.yaml'] } } });

    const g = await fixture();
    github = new MockGitHubClient({ branches: { main: 'b0' }, trees: { b0: {} }, beforeRefWrite: (m) => m.moveBranch(CI_BRANCH, 'other') });
    const moved = await call(g.ws, 'POST', `/agents/${g.agent.id}/export-ci`, { repo: g.repo });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error.code).toBe('ci_concurrent_change');
    expect(github.openedPrs).toEqual([]);
    expect(await db.select().from(t.ciInstallations).where(inArray(t.ciInstallations.agentId, [f.agent.id, g.agent.id]))).toEqual([]);
  });

  it('an open devdigest/ci PR into another base → 409 ci_pr_base_mismatch, nothing committed, no row', async () => {
    const f = await fixture();
    await github.openPullRequest({ owner: 'acme', name: 'x' }, { title: 't', head: CI_BRANCH, base: 'develop', body: 'b' });
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'ci_pr_base_mismatch', details: { pr_base: 'develop', requested_base: 'main' } });
    expect(github.casCommits).toEqual([]);
    expect(await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, f.agent.id))).toEqual([]);
  });

  it('a GitHub failure → 502 with the reason and no row; validation errors → 422 (AC-CI-33, 34, 35)', async () => {
    const f = await fixture();
    github = new MockGitHubClient({ failWith: { getDefaultBranch: 401 } });
    const res = await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: f.repo });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'external_service_error', details: { status: 401 } });
    expect(await db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, f.agent.id))).toEqual([]);

    expect((await call(f.ws, 'POST', `/agents/${f.agent.id}/export-ci`, { repo: 'acme/not-in-workspace' })).statusCode).toBe(422);
    expect((await call(f.ws, 'POST', '/agents/not-a-uuid/export-ci', { repo: f.repo })).statusCode).toBe(422);
    expect((await call(f.ws, 'GET', '/ci/installations?repo=bad')).statusCode).toBe(422);
  });
});
