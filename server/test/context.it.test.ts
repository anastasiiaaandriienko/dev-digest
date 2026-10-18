import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockAuthProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';

/**
 * Project Context folder against real Postgres: Drizzle `ContextRepository`
 * through the HTTP API (roots upsert, attachments, workspace scoping) and a full
 * review run with a mock LLM (marker reaches the provider, never the DB).
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Safe run command (guard
 * DATABASE_URL; LLM, GitHub and secrets are fakes, no network is used):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const MARKER = 'RULE-CTX-7f3a';

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 90,
  findings: [],
};

d('Project Context (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: FastifyInstance | null = null;
  let seq = 0;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
    for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true });
  });
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function makeApp(opts: { llm?: MockLLMProvider; auth?: MockAuthProvider } = {}) {
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ pulls: [] }),
        ...(opts.auth ? { auth: opts.auth } : {}),
        ...(opts.llm ? { llm: { openai: opts.llm } } : {}),
      },
    });
    return app;
  }

  /** A temp clone dir (realpath) holding the given files. */
  async function makeClone(files: Record<string, string>): Promise<string> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'ctx-it-')));
    tmpDirs.push(dir);
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(dir, rel);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, text, 'utf8');
    }
    return dir;
  }

  async function newRepo(ws: string, clonePath: string | null) {
    const name = `ctx-it-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    return repo!;
  }

  async function newAgent(ws: string, name = 'ctx-agent') {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws, name: `${name}-${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review' })
      .returning();
    return agent!;
  }

  async function newSkill(ws: string) {
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId: ws, name: `ctx-skill-${seq++}`, description: 'd', type: 'custom', source: 'manual', body: 'body' })
      .returning();
    return skill!;
  }

  async function newPr(ws: string, repoId: string) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId,
        number: 700 + seq++,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'No linked issues.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  async function secondWorkspace() {
    const db = pg.handle.db;
    const [ws2] = await db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const [user2] = await db.insert(t.users).values({ email: `u${seq}@other.local`, name: 'Other' }).returning();
    await db.insert(t.workspaceMembers).values({ workspaceId: ws2!.id, userId: user2!.id, role: 'owner' });
    return {
      ws: ws2!,
      user: user2!,
      auth: new MockAuthProvider(
        { id: user2!.id, email: user2!.email, name: user2!.name },
        { id: ws2!.id, name: ws2!.name },
      ),
    };
  }

  const rootsRows = (repoId: string, ws = workspaceId) =>
    pg.handle.db
      .select()
      .from(t.settings)
      .where(and(eq(t.settings.workspaceId, ws), isNull(t.settings.userId), eq(t.settings.key, `context_roots:${repoId}`)));

  it('AC-CTX-14 migration 0014 created agent_context_docs and skill_context_docs', async () => {
    const rows = (await pg.handle.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('agent_context_docs', 'skill_context_docs') order by table_name`,
    )) as unknown as { table_name: string }[];
    expect(Array.from(rows).map((r) => r.table_name)).toEqual(['agent_context_docs', 'skill_context_docs']);
  });

  it('AC-CTX-03 roots save/read via the API; repeated and concurrent saves leave one workspace-level row', async () => {
    const a = await makeApp();
    const repo = await newRepo(workspaceId, null);

    const defaults = await a.inject({ method: 'GET', url: `/repos/${repo.id}/context/roots` });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().roots).toEqual(['specs', 'docs', 'insights']);

    const put = await a.inject({ method: 'PUT', url: `/repos/${repo.id}/context/roots`, payload: { roots: ['docs'] } });
    expect(put.statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/repos/${repo.id}/context/roots` })).json().roots).toEqual(['docs']);

    for (const roots of [['specs'], ['docs', 'notes']]) {
      expect((await a.inject({ method: 'PUT', url: `/repos/${repo.id}/context/roots`, payload: { roots } })).statusCode).toBe(200);
    }
    expect(await rootsRows(repo.id)).toHaveLength(1);

    // Concurrent saves on a repo with no row yet: advisory lock must serialize the insert.
    const fresh = await newRepo(workspaceId, null);
    const sets = ['a', 'b', 'c', 'd', 'e', 'f'].map((r) => [r]);
    const results = await Promise.all(
      sets.map((roots) => a.inject({ method: 'PUT', url: `/repos/${fresh.id}/context/roots`, payload: { roots } })),
    );
    expect(results.map((r) => r.statusCode)).toEqual(sets.map(() => 200));
    const rows = await rootsRows(fresh.id);
    expect(rows).toHaveLength(1);
    const final = (await a.inject({ method: 'GET', url: `/repos/${fresh.id}/context/roots` })).json().roots;
    expect(sets.map((s) => s[0])).toContain(final[0]);
    expect(rows[0]!.value).toEqual(final);
  });

  for (const kind of ['agent', 'skill'] as const) {
    it(`AC-CTX-14 ${kind} attachment CRUD: 201 then 200 idempotent, list, order 1..n, detach`, async () => {
      const a = await makeApp();
      const clone = await makeClone({ 'docs/a.md': '# A', 'docs/b.md': '# B' });
      const repo = await newRepo(workspaceId, clone);
      const owner = kind === 'agent' ? await newAgent(workspaceId) : await newSkill(workspaceId);
      const base = `/${kind}s/${owner.id}/context-docs`;
      const qs = `?repo_id=${repo.id}`;

      const first = await a.inject({ method: 'POST', url: base + qs, payload: { path: 'docs/a.md' } });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ repo_id: repo.id, path: 'docs/a.md', order: 1, status: 'ok' });
      const again = await a.inject({ method: 'POST', url: base + qs, payload: { path: 'docs/a.md' } });
      expect(again.statusCode).toBe(200);
      expect(again.json().id).toBe(first.json().id);
      const second = await a.inject({ method: 'POST', url: base + qs, payload: { path: './docs/b.md' } });
      expect(second.statusCode).toBe(201);
      expect(second.json()).toMatchObject({ path: 'docs/b.md', order: 2 });

      const list = (await a.inject({ method: 'GET', url: base + qs })).json();
      expect(list.map((r: { path: string; order: number }) => [r.path, r.order])).toEqual([
        ['docs/a.md', 1],
        ['docs/b.md', 2],
      ]);

      const del = await a.inject({ method: 'DELETE', url: `${base}/${first.json().id}` });
      expect(del.statusCode).toBe(200);
      expect((await a.inject({ method: 'GET', url: base + qs })).json()).toHaveLength(1);
      expect((await a.inject({ method: 'DELETE', url: `${base}/${first.json().id}` })).statusCode).toBe(404);
    });
  }

  it('AC-CTX-14 concurrent attaches of distinct paths: order values stay unique under the per-owner advisory lock', async () => {
    const a = await makeApp();
    const files: Record<string, string> = {};
    for (let i = 1; i <= 8; i++) files[`docs/c${i}.md`] = `# C${i}`;
    const repo = await newRepo(workspaceId, await makeClone(files));
    const agent = await newAgent(workspaceId);
    const res = await Promise.all(
      Object.keys(files).map((path) =>
        a.inject({ method: 'POST', url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`, payload: { path } }),
      ),
    );
    expect(res.map((r) => r.statusCode)).toEqual(Object.keys(files).map(() => 201));
    const rows = await pg.handle.db.select().from(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agent.id));
    expect(rows).toHaveLength(8);
    const orders = rows.map((r) => r.order).sort((x, y) => x - y);
    // Expected: 1..8 without duplicates, so run-time injection order is deterministic.
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('AC-CTX-101 concurrent reorder/attach and reorder/reorder keep distinct gap-free orders under the advisory lock', async () => {
    const a = await makeApp();
    type Dto = { id: string; path: string; order: number };

    for (const kind of ['agent', 'skill'] as const) {
      const files: Record<string, string> = {};
      for (const n of ['a', 'b', 'c', 'd']) files[`docs/${n}.md`] = `# ${n}`;
      const repo = await newRepo(workspaceId, await makeClone(files));
      const owner = kind === 'agent' ? await newAgent(workspaceId) : await newSkill(workspaceId);
      const base = `/${kind}s/${owner.id}/context-docs`;
      const qs = `?repo_id=${repo.id}`;

      const attach = (path: string) => a.inject({ method: 'POST', url: base + qs, payload: { path } });
      const put = (ids: string[]) => a.inject({ method: 'PUT', url: `${base}/order${qs}`, payload: { ids } });
      const stored = async (): Promise<{ id: string; path: string; order: number }[]> => {
        const rows =
          kind === 'agent'
            ? await pg.handle.db
                .select()
                .from(t.agentContextDocs)
                .where(and(eq(t.agentContextDocs.agentId, owner.id), eq(t.agentContextDocs.repoId, repo.id)))
            : await pg.handle.db
                .select()
                .from(t.skillContextDocs)
                .where(and(eq(t.skillContextDocs.skillId, owner.id), eq(t.skillContextDocs.repoId, repo.id)));
        return rows.map((r) => ({ id: r.id, path: r.path, order: r.order })).sort((x, y) => x.order - y.order);
      };
      /** Orders are exactly 1..n with no duplicates. */
      const expectGapFree = (rows: { order: number }[]) =>
        expect(rows.map((r) => r.order).sort((x, y) => x - y)).toEqual(rows.map((_, i) => i + 1));

      const seeded: Dto[] = [];
      for (const n of ['a', 'b', 'c']) {
        const r = await attach(`docs/${n}.md`);
        expect(r.statusCode).toBe(201);
        seeded.push(r.json());
      }
      const [ida, idb, idc] = seeded.map((r) => r.id) as [string, string, string];
      expectGapFree(await stored());

      // (1) reorder vs attach of a new path. The lock gives two legal outcomes:
      //   reorder first  -> 200 [c,b,a], then d appended at order 4;
      //   attach first   -> reorder sees 4 rows, answers 422, table stays [a,b,c,d].
      const [reordered, attached] = await Promise.all([put([idc, idb, ida]), attach('docs/d.md')]);
      expect([200, 422]).toContain(reordered.statusCode);
      expect(attached.statusCode).toBe(201);
      expect(attached.json().order).toBe(4);
      const afterMixed = await stored();
      expect(afterMixed).toHaveLength(4);
      expectGapFree(afterMixed);
      if (reordered.statusCode === 200) {
        const body = reordered.json() as Dto[];
        expect(body.map((r) => [r.path, r.order])).toEqual([
          ['docs/c.md', 1],
          ['docs/b.md', 2],
          ['docs/a.md', 3],
        ]);
        expect(afterMixed.map((r) => r.path)).toEqual(['docs/c.md', 'docs/b.md', 'docs/a.md', 'docs/d.md']);
      } else {
        expect(afterMixed.map((r) => r.path)).toEqual(['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md']);
      }
      const idd = afterMixed.find((r) => r.path === 'docs/d.md')!.id;

      // (2) two reorders with different permutations of the full set.
      const p1 = [idd, ida, idc, idb];
      const p2 = [idb, idd, ida, idc];
      const [r1, r2] = await Promise.all([put(p1), put(p2)]);
      expect([200, 422]).toContain(r1.statusCode);
      expect([200, 422]).toContain(r2.statusCode);
      const winners: string[][] = [];
      for (const [res, ids] of [[r1, p1], [r2, p2]] as const) {
        if (res.statusCode !== 200) continue;
        // Re-selected in the same transaction: the response is exactly the requested permutation.
        const body = res.json() as Dto[];
        expect(body.map((r) => r.id)).toEqual(ids);
        expect(body.map((r) => r.order)).toEqual([1, 2, 3, 4]);
        winners.push([...ids]);
      }
      expect(winners.length).toBeGreaterThan(0);
      const finalRows = await stored();
      expect(finalRows).toHaveLength(4);
      expectGapFree(finalRows);
      expect(winners).toContainEqual(finalRows.map((r) => r.id));
    }
  });

  it('AC-CTX-19 attachment/settings rows and run_traces hold paths only, never doc text', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW });
    const a = await makeApp({ llm });
    const clone = await makeClone({ 'docs/spec.md': `# Spec\n\nRule: ${MARKER} must hold.\n` });
    const repo = await newRepo(workspaceId, clone);
    const agent = await newAgent(workspaceId);
    const skill = await newSkill(workspaceId);
    const pr = await newPr(workspaceId, repo.id);

    await a.inject({ method: 'PUT', url: `/repos/${repo.id}/context/roots`, payload: { roots: ['docs'] } });
    expect((await a.inject({ method: 'POST', url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`, payload: { path: 'docs/spec.md' } })).statusCode).toBe(201);
    expect((await a.inject({ method: 'POST', url: `/skills/${skill.id}/context-docs?repo_id=${repo.id}`, payload: { path: 'docs/spec.md' } })).statusCode).toBe(201);

    const run = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(run.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const like = `%${MARKER}%`;
    const count = async (query: ReturnType<typeof sql>) => {
      const r = (await pg.handle.db.execute(query)) as unknown as { n: number | string }[];
      return Number(Array.from(r)[0]!.n);
    };
    expect(await count(sql`select count(*) as n from run_traces where trace::text like ${like}`)).toBe(0);
    expect(await count(sql`select count(*) as n from agent_context_docs where to_jsonb(agent_context_docs)::text like ${like}`)).toBe(0);
    expect(await count(sql`select count(*) as n from skill_context_docs where to_jsonb(skill_context_docs)::text like ${like}`)).toBe(0);
    expect(await count(sql`select count(*) as n from settings where to_jsonb(settings)::text like ${like}`)).toBe(0);
    // sanity: the rows do hold the path
    expect(await count(sql`select count(*) as n from agent_context_docs where path = 'docs/spec.md'`)).toBeGreaterThan(0);
  });

  it('AC-CTX-30 another workspace (and its user) cannot read, attach or detach this workspace docs: 404', async () => {
    const owner = await makeApp();
    const clone = await makeClone({ 'docs/spec.md': `# Spec ${MARKER}` });
    const repo = await newRepo(workspaceId, clone);
    const agent = await newAgent(workspaceId);
    const skill = await newSkill(workspaceId);
    const a1 = (await owner.inject({ method: 'POST', url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`, payload: { path: 'docs/spec.md' } })).json();
    const s1 = (await owner.inject({ method: 'POST', url: `/skills/${skill.id}/context-docs?repo_id=${repo.id}`, payload: { path: 'docs/spec.md' } })).json();
    await owner.close();
    app = null;

    const other = await secondWorkspace();
    const otherAgent = await newAgent(other.ws.id, 'other-agent');
    const otherSkill = await newSkill(other.ws.id);
    const b = await makeApp({ auth: other.auth });
    const qs = `?repo_id=${repo.id}`;

    const expect404 = async (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) => {
      const r = await b.inject({ method, url, ...(payload ? { payload } : {}) });
      expect([method, url, r.statusCode]).toEqual([method, url, 404]);
    };
    // foreign repo
    await expect404('GET', `/repos/${repo.id}/context/roots`);
    await expect404('PUT', `/repos/${repo.id}/context/roots`, { roots: ['docs'] });
    await expect404('GET', `/repos/${repo.id}/context`);
    await expect404('GET', `/repos/${repo.id}/context/file?path=docs/spec.md`);
    // foreign agent / skill
    await expect404('GET', `/agents/${agent.id}/context-docs${qs}`);
    await expect404('POST', `/agents/${agent.id}/context-docs${qs}`, { path: 'docs/spec.md' });
    await expect404('DELETE', `/agents/${agent.id}/context-docs/${a1.id}`);
    await expect404('GET', `/skills/${skill.id}/context-docs${qs}`);
    await expect404('POST', `/skills/${skill.id}/context-docs${qs}`, { path: 'docs/spec.md' });
    await expect404('DELETE', `/skills/${skill.id}/context-docs/${s1.id}`);
    // own agent/skill but foreign repo, and own agent with a foreign attachment id
    await expect404('POST', `/agents/${otherAgent.id}/context-docs${qs}`, { path: 'docs/spec.md' });
    await expect404('GET', `/skills/${otherSkill.id}/context-docs${qs}`);
    await expect404('DELETE', `/agents/${otherAgent.id}/context-docs/${a1.id}`);
    await expect404('DELETE', `/skills/${otherSkill.id}/context-docs/${s1.id}`);

    // nothing changed for the owner workspace
    expect(await pg.handle.db.select().from(t.agentContextDocs).where(eq(t.agentContextDocs.id, a1.id))).toHaveLength(1);
    expect(await pg.handle.db.select().from(t.skillContextDocs).where(eq(t.skillContextDocs.id, s1.id))).toHaveLength(1);
    expect(await rootsRows(repo.id, other.ws.id)).toHaveLength(0);
    expect(await rootsRows(repo.id)).toHaveLength(0);
  });

  it('AC-CTX-45 marker reaches the provider inside <untrusted source="spec-0">; the persisted trace has placeholders only', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW });
    const a = await makeApp({ llm });
    const clone = await makeClone({ 'docs/spec.md': `# Spec\n\nEvery handler must satisfy ${MARKER}.\n` });
    const repo = await newRepo(workspaceId, clone);
    const agent = await newAgent(workspaceId);
    const pr = await newPr(workspaceId, repo.id);
    expect((await a.inject({ method: 'POST', url: `/agents/${agent.id}/context-docs?repo_id=${repo.id}`, payload: { path: 'docs/spec.md' } })).statusCode).toBe(201);

    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs.find((r) => r.id === runId)!.status).toBe('done');

    type Msg = { role: string; content: string };
    const calls = llm.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) => (c.req as { messages: Msg[] }).messages);
    const withMarker = calls.filter((m) => m.some((x) => x.content.includes(MARKER)));
    expect(withMarker.length).toBeGreaterThan(0);
    for (const messages of withMarker) {
      const carrier = messages.filter((x) => x.content.includes(MARKER));
      expect(carrier.every((x) => x.role === 'user')).toBe(true);
      const body = carrier[0]!.content;
      expect(body).toMatch(new RegExp(`<untrusted source="spec-0">[\\s\\S]*${MARKER}[\\s\\S]*</untrusted>`));
    }

    const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    const trace = row!.trace as {
      specs_read: string[];
      prompt_assembly: { spec_blocks?: unknown[] | null; specs_tokens?: number | null };
    };
    expect(trace.specs_read).toEqual(['docs/spec.md']);
    expect(trace.prompt_assembly.spec_blocks).toHaveLength(1);
    expect(trace.prompt_assembly.specs_tokens).toBeGreaterThan(0);
    expect(JSON.stringify(row!.trace)).not.toContain(MARKER);

    // the trace API serves the same redacted document
    const api = await a.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    expect(api.statusCode).toBe(200);
    expect(api.payload).not.toContain(MARKER);
    expect(api.json().specs_read).toEqual(['docs/spec.md']);
  });
});
