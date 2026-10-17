import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PullLookup, type PrDetail, type PrMeta, type RepoRef } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { PULL_LOOKUP_LIMIT } from '../src/modules/pulls/service.js';
import * as t from '../src/db/schema.js';

/**
 * GET /pulls?number=&title=&repo= — read-only lookup of STORED PRs used by the
 * MCP tools to name a PR by number / title. Returns every match (never picks
 * one), is workspace-scoped, and never syncs GitHub or writes.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Safe run command:
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/pulls-lookup.it.test.ts
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

class ForbiddenGitHub extends MockGitHubClient {
  calls: string[] = [];
  override async listPullRequests(_repo: RepoRef): Promise<PrMeta[]> {
    this.calls.push('listPullRequests');
    throw new Error('GitHub must not be called by GET /pulls');
  }
  override async getPullRequest(_repo: RepoRef, _n: number): Promise<PrDetail> {
    this.calls.push('getPullRequest');
    throw new Error('GitHub must not be called by GET /pulls');
  }
}

d('GET /pulls lookup (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let ws: string;
  const repo: Record<string, string> = {};
  const pr: Record<string, string> = {};
  const github = new ForbiddenGitHub({ pulls: [] });

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [w] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    ws = w!.id;
    const [other] = await db.insert(t.workspaces).values({ name: 'other' }).returning();

    const addRepo = async (key: string, workspaceId: string, owner: string, name: string) => {
      const [r] = await db.insert(t.repos).values({ workspaceId, owner, name, fullName: `${owner}/${name}` }).returning();
      repo[key] = r!.id;
    };
    await addRepo('alpha', ws, 'alice', 'dev-digest');
    await addRepo('beta', ws, 'bob', 'dev-digest'); // same short name, other owner
    await addRepo('gamma', ws, 'acme', 'payments');
    await addRepo('foreign', other!.id, 'evil', 'secret');

    const addPr = async (key: string, workspaceId: string, repoKey: string, number: number, title: string) => {
      const [p] = await db
        .insert(t.pullRequests)
        .values({ workspaceId, repoId: repo[repoKey]!, number, title, author: 'a', branch: 'b', base: 'main', headSha: 's', status: 'open' })
        .returning();
      pr[key] = p!.id;
    };
    await addPr('a3', ws, 'alpha', 3, '[DO NOT MERGE] API contract changes');
    await addPr('a5', ws, 'alpha', 5, 'test: add skill budget helpers');
    await addPr('b3', ws, 'beta', 3, 'Rate limit 100% of public routes'); // same number, other repo
    await addPr('g9', ws, 'gamma', 9, 'Refactor invoice_pdf renderer');
    await addPr('f7', other!.id, 'foreign', 7, 'skill budget in another workspace');
    for (let i = 0; i < PULL_LOOKUP_LIMIT + 1; i++) await addPr(`bulk${i}`, ws, 'gamma', 100 + i, `bulk lab ${i}`);

    app = await buildApp({ config: config(), db, overrides: { secrets: new MockSecretsProvider({}), github } });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const lookup = async (qs: string) => {
    const res = await app.inject({ method: 'GET', url: `/pulls?${qs}` });
    return { status: res.statusCode, body: res.statusCode === 200 ? PullLookup.parse(res.json()) : res.json() };
  };
  const ids = (b: PullLookup) => b.matches.map((m) => m.id);

  it('number + repo "owner/name" → exactly that PR', async () => {
    const { status, body } = await lookup('number=3&repo=alice/dev-digest');
    expect(status).toBe(200);
    expect(ids(body as PullLookup)).toEqual([pr.a3]);
    expect((body as PullLookup).repo_matches).toEqual([{ id: repo.alpha, full_name: 'alice/dev-digest' }]);
    expect((body as PullLookup).matches[0]).toMatchObject({ number: 3, repo_full_name: 'alice/dev-digest' });
  });

  it('number + repo uuid, and owner/name case-insensitively', async () => {
    expect(ids((await lookup(`number=3&repo=${repo.beta}`)).body as PullLookup)).toEqual([pr.b3]);
    expect(ids((await lookup('number=3&repo=ALICE/Dev-Digest')).body as PullLookup)).toEqual([pr.a3]);
  });

  it('number alone: one match when unique, every match when not (never just the first)', async () => {
    expect(ids((await lookup('number=5')).body as PullLookup)).toEqual([pr.a5]);
    expect(ids((await lookup('number=3')).body as PullLookup).sort()).toEqual([pr.a3, pr.b3].sort());
  });

  it('a short repo name matching two repositories reports both in repo_matches', async () => {
    const body = (await lookup('number=3&repo=dev-digest')).body as PullLookup;
    expect(body.repo_matches!.map((r) => r.full_name)).toEqual(['alice/dev-digest', 'bob/dev-digest']);
    expect(body.matches).toHaveLength(2);
  });

  it('title: case-insensitive substring; % and _ are literal, not wildcards', async () => {
    expect(ids((await lookup('title=SKILL%20budget')).body as PullLookup)).toEqual([pr.a5]);
    expect(ids((await lookup('title=100%25')).body as PullLookup)).toEqual([pr.b3]);
    expect(ids((await lookup('title=invoice_pdf')).body as PullLookup)).toEqual([pr.g9]);
    expect(ids((await lookup('title=invoice%25pdf')).body as PullLookup)).toEqual([]);
  });

  it('not found: unknown number, unknown repo (repo_matches = [])', async () => {
    expect((await lookup('number=4242')).body).toEqual({ matches: [], truncated: false, repo_matches: null });
    expect((await lookup('number=3&repo=nobody/nothing')).body).toEqual({ matches: [], truncated: false, repo_matches: [] });
  });

  it('is workspace-scoped: another workspace PR and repo are invisible', async () => {
    expect(ids((await lookup('title=skill%20budget')).body as PullLookup)).toEqual([pr.a5]);
    expect((await lookup('number=7&repo=evil/secret')).body).toMatchObject({ matches: [], repo_matches: [] });
    expect(ids((await lookup('number=7')).body as PullLookup)).toEqual([]);
  });

  it(`returns at most ${PULL_LOOKUP_LIMIT} matches and sets truncated`, async () => {
    const body = (await lookup('title=bulk%20lab')).body as PullLookup;
    expect(body.matches).toHaveLength(PULL_LOOKUP_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it('invalid input is 422: no filter, repo alone, number 0, non-numeric number, 1-char title', async () => {
    for (const qs of ['', 'repo=alice/dev-digest', 'number=0', 'number=abc', 'title=x']) {
      expect((await lookup(qs)).status, qs).toBe(422);
    }
  });

  it('never calls GitHub and writes nothing', async () => {
    const db = pg.handle.db;
    const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(t.pullRequests))[0]!.n;
    const before = await count();
    github.calls = [];
    await lookup('number=3');
    await lookup('title=skill&repo=alice/dev-digest');
    expect(github.calls).toEqual([]);
    expect(await count()).toBe(before);
  });
});
