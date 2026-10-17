import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { IssueMeta, LLMProvider, RepoRef, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { PrIntentState } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

/**
 * L03 intent context over HTTP + Postgres: POST /pulls/:id/intent reads the
 * linked issues of the PR's own repository (mock GitHub), stores per-source
 * statuses in pr_intent.context_sources (migration 0013), and GET returns them
 * without calling GitHub again. No URL from the description is ever fetched.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Safe run command (guard
 * DATABASE_URL; the LLM, GitHub and secrets are fakes, no network is used):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/intent-context.it.test.ts
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const OVERRIDE = { provider: 'openrouter', model: 'fake/intent-model' } as const;
const GOOD = { intent: 'Adds retry', in_scope: ['retry'], out_of_scope: [], risk_areas: [], confidence: 'medium' };

class FakeLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  prompts: string[] = [];
  async listModels(): Promise<never> {
    throw new Error('no');
  }
  async complete(): Promise<never> {
    throw new Error('no');
  }
  async embed(): Promise<never> {
    throw new Error('no');
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.prompts.push(req.messages.map((m) => m.content).join('\n'));
    return { data: GOOD as T, model: req.model, tokensIn: 10, tokensOut: 5, costUsd: 0.001, raw: '', attempts: 1 };
  }
}

/** Mock GitHub whose issues can be set per number; records every issue lookup. */
class IssuesGitHub extends MockGitHubClient {
  lookups: { repo: RepoRef; n: number }[] = [];
  issues = new Map<number, IssueMeta>();
  override async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    this.lookups.push({ repo, n });
    const issue = this.issues.get(n);
    if (!issue) throw Object.assign(new Error('Not Found'), { status: 404 });
    return issue;
  }
}

d('L03 intent context (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: FastifyInstance | null = null;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
    const db = pg.handle.db;
    await db.delete(t.settings).where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'feature_models')));
    await db.insert(t.settings).values({ workspaceId, key: 'feature_models', value: { review_intent: OVERRIDE } });
  });
  afterAll(async () => {
    await pg?.stop();
  });
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function makeApp(github: IssuesGitHub, llm: FakeLLM) {
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), github, llm: { openrouter: llm } },
    });
    return app;
  }

  async function newPr(body: string, files: { path: string; patch: string }[] = [{ path: 'src/a.ts', patch: '@@ -1 +1,2 @@ fn\n x\n+y' }]) {
    const db = pg.handle.db;
    const name = `ctx-${seq++}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 500 + seq,
        title: 'Add retry',
        author: 'marisa.koch',
        branch: 'feat/retry',
        base: 'main',
        headSha: 'sha-1',
        filesCount: files.length,
        status: 'needs_review',
        body,
      })
      .returning();
    for (const f of files) await db.insert(t.prFiles).values({ prId: pr!.id, path: f.path, additions: 1, deletions: 0, patch: f.patch });
    return { prId: pr!.id, repoName: name };
  }

  it('POST stores issue / link / plan-doc statuses; GET returns them without another GitHub call', async () => {
    const github = new IssuesGitHub({ pulls: [] });
    github.issues.set(12, { number: 12, title: 'Retry webhooks', body: 'Deliveries fail silently', state: 'open' });
    const llm = new FakeLLM();
    const a = await makeApp(github, llm);
    const { prId, repoName } = await newPr(
      'Fixes #12 and #13. Plan in docs/plans/retry.md, ticket https://linear.app/acme/issue/ENG-1?token=secret',
      [
        { path: 'src/a.ts', patch: '@@ -1 +1,2 @@ fn\n x\n+y' },
        { path: 'docs/plans/retry.md', patch: '@@ -0,0 +1,2 @@\n+Goal: retry failed deliveries\n+Non-goal: DLQ' },
      ],
    );

    const posted = await a.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
    expect(posted.statusCode).toBe(200);
    const state = PrIntentState.parse(posted.json());
    expect(state.computed).toBe(true);
    expect(github.lookups.map((l) => [l.repo.owner, l.repo.name, l.n])).toEqual([
      ['acme', repoName, 12],
      ['acme', repoName, 13],
    ]);
    expect(state.context_sources).toEqual([
      { kind: 'pr_title', status: 'confirmed', ref: 'title' },
      { kind: 'pr_description', status: 'confirmed', ref: 'description' },
      { kind: 'linked_issue', status: 'confirmed', ref: '#12', title: 'Retry webhooks' },
      { kind: 'linked_issue', status: 'unavailable', ref: '#13', note: 'not_found_or_no_access' },
      { kind: 'ticket_link', status: 'unverified', ref: 'https://linear.app/acme/issue/ENG-1', note: 'not_fetched' },
      { kind: 'plan_doc', status: 'confirmed', ref: 'docs/plans/retry.md' },
    ]);
    expect(llm.prompts[0]).toContain('Deliveries fail silently');
    expect(llm.prompts[0]).toContain('Goal: retry failed deliveries');

    // Persisted: statuses + a content hash, never the issue body or the URL query.
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    const stored = JSON.stringify(row!.contextSources);
    expect(stored).not.toContain('Deliveries fail silently');
    expect(stored).not.toContain('token=secret');
    expect(row!.contextSources!.find((s) => s.ref === '#12')!.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const lookups = github.lookups.length;
    const got = await a.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ freshness: 'fresh', context_sources: state.context_sources });
    expect(github.lookups).toHaveLength(lookups);
  });

  it('unchanged issues → cache hit; changed issue text → recomputed', async () => {
    const github = new IssuesGitHub({ pulls: [] });
    github.issues.set(7, { number: 7, title: 'Scope', body: 'v1', state: 'open' });
    const llm = new FakeLLM();
    const a = await makeApp(github, llm);
    const { prId } = await newPr('Closes #7');

    expect((await a.inject({ method: 'POST', url: `/pulls/${prId}/intent` })).json().computed).toBe(true);
    expect((await a.inject({ method: 'POST', url: `/pulls/${prId}/intent` })).json().computed).toBe(false);
    github.issues.set(7, { number: 7, title: 'Scope', body: 'v2 — scope widened', state: 'open' });
    expect((await a.inject({ method: 'POST', url: `/pulls/${prId}/intent` })).json().computed).toBe(true);
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1]).toContain('v2 — scope widened');
  });

  it('a legacy row without context_sources reads as null (not recorded)', async () => {
    const github = new IssuesGitHub({ pulls: [] });
    const a = await makeApp(github, new FakeLLM());
    const { prId } = await newPr('No refs');
    await pg.handle.db.insert(t.prIntent).values({ prId, intent: 'old', inScope: [], outOfScope: [] });
    const got = await a.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(got.statusCode).toBe(200);
    expect(got.json().context_sources).toBeNull();
    expect(github.lookups).toEqual([]);
  });
});
