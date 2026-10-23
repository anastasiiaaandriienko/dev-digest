import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EvalService } from '../src/modules/evals/service.js';
import type { Container } from '../src/platform/container.js';
import { assertThrowawayDb } from './helpers/eval-fixtures.js';

/**
 * L06 eval cases from decided findings (specs/eval-pipeline.md §5, §7, §13;
 * ACs 01-08, 30, 36) against a THROWAWAY Testcontainers Postgres. The working
 * database is never used: every URL is checked against DATABASE_URL first.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const RAW_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,6 @@',
  ' const a = 1;',
  '+const b = 2;',
  '+const c = 3;',
  '+const d = 4;',
  '+const e = 5;',
  ' export { a };',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -10,2 +10,4 @@',
  ' function f() {',
  '+  return 1;',
  '+  // todo',
  ' }',
].join('\n');

d('L06 eval cases from findings (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let agentId: string;
  let prId: string;
  let reviewId: string;

  beforeAll(async () => {
    pg = await startPg();
    assertThrowawayDb(pg.url);
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: loadConfig({ ...process.env, DATABASE_URL: pg.url, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient({ pulls: [] }),
        git: new MockGitClient({ diff: RAW_DIFF }),
        embedder: new MockEmbedder(),
      },
    });
    const db = pg.handle.db;
    const name = `eval-${randomUUID().slice(0, 8)}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 42,
        title: 'Add constants',
        author: 'dev',
        branch: 'feat',
        base: 'main',
        headSha: 'head-42',
        body: 'Adds constants.',
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId, name: `Eval agent ${name}`, provider: 'openrouter', model: 'm', systemPrompt: 'review' })
      .returning();
    agentId = agent!.id;
    const [rev] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, runId: null, kind: 'review', verdict: 'comment', summary: 's', score: 50, model: 'm' })
      .returning();
    reviewId = rev!.id;
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function finding(file: string, start: number, end: number, over: Partial<typeof t.findings.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId,
        file,
        startLine: start,
        endLine: end,
        severity: 'WARNING',
        category: 'bug',
        title: `Issue at ${file}:${start}`,
        rationale: 'r',
        confidence: 0.8,
        ...over,
      })
      .returning();
    return row!.id;
  }
  const decide = (id: string, action: 'accept' | 'dismiss') =>
    app.inject({ method: 'POST', url: `/findings/${id}/${action}` });
  const toCase = (id: string, payload?: object) =>
    app.inject({ method: 'POST', url: `/findings/${id}/eval-case`, ...(payload ? { payload } : {}) });

  it('accepted finding → must_find case with frozen diff, meta, location, hash, provenance (AC-01)', async () => {
    const id = await finding('./src/a.ts', 3, 2);
    await decide(id, 'accept');
    const res = await toCase(id);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      agent_id: agentId,
      kind: 'must_find',
      source_finding_id: id,
      expected: { kind: 'must_find', file: 'src/a.ts', start_line: 2, end_line: 3 },
      meta: { pr_number: 42, pr_title: 'Add constants', pr_body: 'Adds constants.', head_sha: 'head-42', source_review_id: reviewId },
    });
    expect(body.input_hash).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, body.id));
    expect(row!.inputDiff).toContain('+const b = 2;');
    expect(row!.workspaceId).toBe(workspaceId);
    expect(row!.createdAt).not.toBeNull();

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${prId}/reviews` })).json();
    const dto = reviews.flatMap((r: { findings: { id: string; eval_case_id: string | null }[] }) => r.findings).find((f: { id: string }) => f.id === id);
    expect(dto.eval_case_id).toBe(body.id);
  });

  it('dismissed finding → must_not_flag case (AC-02)', async () => {
    const id = await finding('src/b.ts', 11, 11);
    await decide(id, 'dismiss');
    const res = await toCase(id, { name: 'no-todo-comment' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'must_not_flag', name: 'no-todo-comment' });
  });

  it('rejects undecided findings and client-sent labels (AC-03, AC-07)', async () => {
    const id = await finding('src/a.ts', 4, 4);
    expect((await toCase(id)).json().error.code).toBe('finding_not_decided');
    await decide(id, 'accept');
    const res = await toCase(id, { kind: 'must_not_flag' });
    expect(res.statusCode).toBe(422);
  });

  it('one case per finding / location / label (AC-04, AC-05)', async () => {
    const pos = await finding('src/a.ts', 5, 5);
    await decide(pos, 'accept');
    const first = await toCase(pos);
    expect(first.statusCode).toBe(201);

    const again = await toCase(pos);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatchObject({ code: 'eval_case_exists', details: { eval_case_id: first.json().id } });

    const dup = await finding('src/a.ts', 5, 6);
    await decide(dup, 'accept');
    expect((await toCase(dup)).json().error.code).toBe('duplicate_location');

    const neg = await finding('src/a.ts', 4, 5);
    await decide(neg, 'dismiss');
    const conflict = await toCase(neg);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('conflicting_label');
  });

  it('rejects wide ranges, locations outside the diff and agent-less findings (AC-06)', async () => {
    const wide = await finding('src/a.ts', 1, 60);
    await decide(wide, 'accept');
    expect((await toCase(wide)).json().error.code).toBe('range_too_wide');

    const outside = await finding('src/b.ts', 90, 90);
    await decide(outside, 'accept');
    expect((await toCase(outside)).json().error.code).toBe('location_not_in_diff');

    const [orphan] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId: null, runId: null, kind: 'review', verdict: 'comment', summary: 's', score: 1, model: 'm' })
      .returning();
    const [f] = await pg.handle.db
      .insert(t.findings)
      .values({ reviewId: orphan!.id, file: 'src/a.ts', startLine: 2, endLine: 2, severity: 'WARNING', category: 'bug', title: 't', rationale: 'r', confidence: 1 })
      .returning();
    await decide(f!.id, 'accept');
    const res = await toCase(f!.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('finding_has_no_agent');
  });

  it('a later decision change leaves the case unchanged (AC-08)', async () => {
    const id = await finding('src/b.ts', 10, 10);
    await decide(id, 'accept');
    const created = (await toCase(id)).json();
    await decide(id, 'dismiss');
    const cases = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json();
    const stored = cases.find((c: { id: string }) => c.id === created.id);
    expect(stored.kind).toBe('must_find');
    expect(stored.expected).toEqual(created.expected);
  });

  it('serializes concurrent creations: one 201, the rest 409 (atomicity)', async () => {
    const sameFinding = await finding('src/b.ts', 12, 12);
    await decide(sameFinding, 'accept');
    const a = await Promise.all([toCase(sameFinding), toCase(sameFinding), toCase(sameFinding)]);
    expect(a.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(a.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === 'eval_case_exists')).toBe(true);

    // two different findings on the same location of the same input
    const x = await finding('src/a.ts', 6, 6);
    const y = await finding('src/a.ts', 6, 6, { title: 'Same place, other finding' });
    await decide(x, 'accept');
    await decide(y, 'accept');
    const b = await Promise.all([toCase(x), toCase(y)]);
    expect(b.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(b.find((r) => r.statusCode === 409)!.json().error.code).toBe('duplicate_location');

    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, sameFinding));
    expect(rows).toHaveLength(1);
  });

  it('isolates workspaces: foreign findings and agents are 404 (AC-30)', async () => {
    const db = pg.handle.db;
    const [ws2] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [repo2] = await db.insert(t.repos).values({ workspaceId: ws2!.id, owner: 'o', name: 'r2', fullName: 'o/r2' }).returning();
    const [pr2] = await db
      .insert(t.pullRequests)
      .values({ workspaceId: ws2!.id, repoId: repo2!.id, number: 1, title: 't', author: 'a', branch: 'b', base: 'main', headSha: 'h' })
      .returning();
    const [agent2] = await db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign agent', provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    const [rev2] = await db
      .insert(t.reviews)
      .values({ workspaceId: ws2!.id, prId: pr2!.id, agentId: agent2!.id, runId: null, kind: 'review', verdict: 'comment', summary: 's', score: 1, model: 'm' })
      .returning();
    const [f2] = await db
      .insert(t.findings)
      .values({ reviewId: rev2!.id, file: 'src/a.ts', startLine: 2, endLine: 2, severity: 'WARNING', category: 'bug', title: 't', rationale: 'r', confidence: 1, acceptedAt: new Date() })
      .returning();

    const res = await toCase(f2!.id);
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${agent2!.id}/eval-cases` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${agent2!.id}/eval-runs` })).statusCode).toBe(404);
    expect(await db.select().from(t.evalCases).where(eq(t.evalCases.workspaceId, ws2!.id))).toHaveLength(0);
  });

  it('lists the agent cases newest first and the (empty) run history', async () => {
    const cases = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json();
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases.every((c: { agent_id: string; last_result: unknown }) => c.agent_id === agentId && c.last_result === null)).toBe(true);
    const runs = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs?limit=5` });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()).toEqual([]);
  });

  it('migration 0015 keeps pre-L06 eval rows unchanged and the pipeline ignores them (AC-36)', async () => {
    // A second database inside the same throwaway container, migrated to 0014 only.
    const legacyUrl = (() => {
      const u = new URL(pg.url);
      u.pathname = '/legacy_l06';
      return u.toString();
    })();
    assertThrowawayDb(legacyUrl);
    const admin = postgres(pg.url, { max: 1 });
    await admin.unsafe('CREATE DATABASE legacy_l06');
    await admin.end();

    const migrationsDir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
    const tmp = mkdtempSync(join(tmpdir(), 'l06-mig-'));
    try {
      cpSync(migrationsDir, tmp, { recursive: true });
      for (const f of readdirSync(tmp)) if (f.startsWith('0015_')) rmSync(join(tmp, f));
      const journalPath = join(tmp, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 14);
      writeFileSync(journalPath, JSON.stringify(journal));

      const sql = postgres(legacyUrl, { max: 1 });
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
      await migrate(drizzle(sql), { migrationsFolder: tmp });
      const cols = await sql`select column_name from information_schema.columns where table_name = 'eval_cases'`;
      expect(cols.map((c) => c.column_name)).not.toContain('kind'); // really pre-0015

      const [ws] = await sql`insert into workspaces (name) values ('legacy') returning id`;
      const [agent] = await sql`insert into agents (workspace_id, name, provider, model, system_prompt)
        values (${ws!.id}, 'Legacy agent', 'openai', 'm', 'p') returning id`;
      await sql`insert into eval_cases (workspace_id, owner_kind, owner_id, name, input_diff, input_meta, expected_output, notes)
        values (${ws!.id}, 'agent', ${agent!.id}, 'legacy-agent-case', 'diff', ${JSON.stringify({ a: 1 })}::jsonb, ${JSON.stringify([{ x: 1 }])}::jsonb, 'n'),
               (${ws!.id}, 'skill', ${agent!.id}, 'legacy-skill-case', null, null, null, null)`;
      const [legacyCase] = await sql`select id from eval_cases where name = 'legacy-agent-case'`;
      await sql`insert into eval_runs (case_id, actual_output, pass, recall, precision, citation_accuracy, duration_ms, cost_usd)
        values (${legacyCase!.id}, ${JSON.stringify({ y: 2 })}::jsonb, true, 0.5, 0.25, 1, 10, 0.01)`;
      // Compare the DB-side JSON of every row (independent of client type parsing).
      const NEW_CASE_COLS = ['kind', 'source_finding_id', 'input_hash', 'created_at'];
      const NEW_RUN_COLS = ['suite_run_id', 'outcome'];
      const snapshot = async (q: postgres.Sql) => ({
        cases: (await q`select to_jsonb(e) as j from eval_cases e order by name`).map((r) => r.j as Record<string, unknown>),
        runs: (await q`select to_jsonb(r) as j from eval_runs r order by id`).map((r) => r.j as Record<string, unknown>),
      });
      const omit = (o: Record<string, unknown>, keys: string[]) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
      const before = await snapshot(sql);
      await sql.end();

      await runMigrations(legacyUrl); // applies 0015 only

      const q = postgres(legacyUrl, { max: 1 });
      const after = await snapshot(q);
      await q.end();
      expect(after.cases).toHaveLength(2);
      expect(after.runs).toHaveLength(1);
      expect(after.cases.map((r) => omit(r, NEW_CASE_COLS))).toEqual(before.cases);
      expect(after.runs.map((r) => omit(r, NEW_RUN_COLS))).toEqual(before.runs);
      for (const row of after.cases) for (const c of NEW_CASE_COLS) expect(row[c]).toBeNull();
      for (const row of after.runs) for (const c of NEW_RUN_COLS) expect(row[c]).toBeNull();

      // The pipeline never surfaces legacy rows.
      const legacyDb = createDb(legacyUrl, { max: 1 });
      try {
        const service = new EvalService({ db: legacyDb.db } as unknown as Container);
        expect(await service.listCases(ws!.id, agent!.id)).toEqual([]);
      } finally {
        await legacyDb.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
