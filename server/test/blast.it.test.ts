import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { BlastRadius, type PrDetail, type PrMeta, type RepoRef } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * HW-04 Blast Radius over HTTP + Postgres: GET /pulls/:id/blast reads the
 * stored pr_files and the persisted repo-intel index (symbols, resolved
 * references, file_edges, file_rank, file_facts) — no clone, no GitHub, no LLM.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Safe run command (guard
 * DATABASE_URL so dotenv can never point the app at the dev DB):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/blast.it.test.ts
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const INDEXED_SHA = 'indexed0000000000000000000000000000000001';
const PR_HEAD_SHA = 'prhead00000000000000000000000000000000002';

/** Records every GitHub call and fails it: the blast endpoint must never sync. */
class ForbiddenGitHub extends MockGitHubClient {
  calls: string[] = [];
  override async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    this.calls.push('listPullRequests');
    throw new Error('GitHub must not be called by /pulls/:id/blast');
  }
  override async getPullRequest(_repo: RepoRef, _n: number): Promise<PrDetail> {
    this.calls.push('getPullRequest');
    throw new Error('GitHub must not be called by /pulls/:id/blast');
  }
}

d('HW-04 Blast Radius endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId: string;
  let otherWs: string;
  let indexedRepo: string;
  let seq = 0;
  const github = new ForbiddenGitHub({ pulls: [] });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
    const [o] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    otherWs = o!.id;
    indexedRepo = await newRepo(workspaceId);
    await seedIndex(indexedRepo);
    app = await buildApp({
      config: config(),
      db,
      overrides: { secrets: new MockSecretsProvider({}), github },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function newRepo(ws: string): Promise<string> {
    const name = `blast-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    return repo!.id;
  }

  async function newPr(ws: string, repoId: string, files: string[]): Promise<string> {
    const db = pg.handle.db;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId,
        number: 4000 + seq++,
        title: 'Blast',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: PR_HEAD_SHA,
        status: 'open',
      })
      .returning();
    for (const path of files) {
      await db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' });
    }
    return pr!.id;
  }

  /**
   * src/helpers.ts declares toDto (changed). Direct callers: src/service.ts
   * (ranked) and src/jobs/worker.ts (no rank row). src/routes.ts imports
   * service.ts (depth 2); src/index.ts imports routes.ts (depth 3, too far).
   */
  async function seedIndex(repoId: string) {
    const db = pg.handle.db;
    await db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: INDEXED_SHA,
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 5,
      filesSkipped: 0,
    });
    await db.insert(t.symbols).values([
      { repoId, path: 'src/helpers.ts', name: 'toDto', kind: 'function', line: 3, endLine: 9, exported: true },
      { repoId, path: 'src/service.ts', name: 'list', kind: 'method', line: 10, endLine: 20 },
      { repoId, path: 'src/jobs/worker.ts', name: 'runSync', kind: 'function', line: 1, endLine: 12, exported: true },
    ]);
    await db.insert(t.references).values([
      { repoId, fromPath: 'src/service.ts', toSymbol: 'toDto', line: 12, declFile: 'src/helpers.ts' },
      { repoId, fromPath: 'src/service.ts', toSymbol: 'toDto', line: 15, declFile: 'src/helpers.ts' },
      { repoId, fromPath: 'src/jobs/worker.ts', toSymbol: 'toDto', line: 4, declFile: 'src/helpers.ts' },
      { repoId, fromPath: 'src/helpers.ts', toSymbol: 'toDto', line: 8, declFile: 'src/helpers.ts' },
      { repoId, fromPath: 'src/other.ts', toSymbol: 'toDto', line: 2, declFile: null },
    ]);
    await db.insert(t.fileEdges).values([
      { repoId, fromFile: 'src/routes.ts', toFile: 'src/service.ts' },
      { repoId, fromFile: 'src/index.ts', toFile: 'src/routes.ts' },
      { repoId, fromFile: 'src/service.ts', toFile: 'src/helpers.ts' },
    ]);
    await db.insert(t.fileRank).values([
      { repoId, filePath: 'src/service.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 90 },
    ]);
    await db.insert(t.fileFacts).values([
      { repoId, filePath: 'src/routes.ts', endpoints: ['GET /items', 'POST /items'], crons: [] },
      { repoId, filePath: 'src/jobs/worker.ts', endpoints: [], crons: ['job:sync_items'] },
      { repoId, filePath: 'src/index.ts', endpoints: ['GET /too-far'], crons: [] },
      { repoId, filePath: 'src/helpers.ts', endpoints: ['GET /defining-file'], crons: [] },
    ]);
  }

  const get = (prId: string) => app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });

  it('returns 2+ callers with file:line links to the INDEXED commit and the endpoints/crons they reach', async () => {
    const prId = await newPr(workspaceId, indexedRepo, ['src/helpers.ts']);
    const res = await get(prId);

    expect(res.statusCode).toBe(200);
    const blast = BlastRadius.parse(res.json());
    expect(blast.degraded).toBe(false);
    expect(blast.reason).toBeNull();
    expect(blast.source).toEqual({ repo_full_name: expect.stringMatching(/^acme\/blast-/), ref: INDEXED_SHA });
    expect(blast.changed_symbols).toEqual([
      expect.objectContaining({ name: 'toDto', file: 'src/helpers.ts', line: 3 }),
    ]);

    const impact = blast.downstream[0]!;
    // Ranked caller first; the unranked one still counts (rank 0); the defining
    // file and the unresolved reference are not callers.
    expect(impact.callers.map((c) => `${c.name}@${c.file}:${c.line}`)).toEqual([
      'list@src/service.ts:12',
      'runSync@src/jobs/worker.ts:4',
    ]);
    expect(impact.callers[0]!.url).toBe(`https://github.com/${blast.source!.repo_full_name}/blob/${INDEXED_SHA}/src/service.ts#L12`);
    expect(impact.callers.some((c) => c.url?.includes(PR_HEAD_SHA))).toBe(false);
    expect(impact).toMatchObject({ caller_count: 2, truncated: false });
    // routes.ts is reached at depth 2; index.ts (depth 3) and the defining file are not.
    expect(impact.endpoints_affected).toEqual(['GET /items', 'POST /items']);
    expect(impact.crons_affected).toEqual(['job:sync_items']);
    expect(blast.totals).toEqual({ symbols: 1, callers: 2, endpoints: 2, crons: 1 });
    expect(blast.summary).toBe('1 changed symbol, 2 callers; potentially affected: 2 endpoints, 1 cron/job.');
  });

  it('does not sync from GitHub or write PR rows', async () => {
    const prId = await newPr(workspaceId, indexedRepo, ['src/helpers.ts']);
    const db = pg.handle.db;
    const snapshot = async () => ({
      pr: await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId)),
      files: await db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId)).orderBy(asc(t.prFiles.path)),
    });
    const before = await snapshot();
    github.calls = [];

    expect((await get(prId)).statusCode).toBe(200);

    expect(github.calls).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('is workspace-scoped: another workspace PR is 404', async () => {
    const foreignRepo = await newRepo(otherWs);
    await seedIndex(foreignRepo);
    const foreignPr = await newPr(otherWs, foreignRepo, ['src/helpers.ts']);

    const res = await get(foreignPr);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('toDto');
  });

  it('404 for an unknown PR, 422 for an invalid id', async () => {
    expect((await get('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' })).statusCode).toBe(422);
  });

  it('a PR without stored files is degraded no_files', async () => {
    const prId = await newPr(workspaceId, indexedRepo, []);
    const blast = BlastRadius.parse((await get(prId)).json());
    expect(blast).toMatchObject({ changed_symbols: [], downstream: [], degraded: true, reason: 'no_files' });
  });

  it('a repo without an index (and no clone) is degraded no_data, not presented as complete', async () => {
    const bare = await newRepo(workspaceId);
    const prId = await newPr(workspaceId, bare, ['src/helpers.ts']);
    const blast = BlastRadius.parse((await get(prId)).json());
    expect(blast).toMatchObject({ changed_symbols: [], degraded: true, reason: 'no_data' });
    expect(blast.summary).toContain('not indexed yet');
  });
});
