import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RunSummary, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { CostLLMProvider, DIFF, REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';

/**
 * L01 cost read paths over HTTP (specs/review-run-cost.md §4.2, §4.3, T1–T7):
 *   GET /pulls/:id/runs   → RunSummary.cost_usd per run (LEFT JOIN run_traces)
 *   GET /repos/:id/pulls  → PrMeta.cost_usd / cost_partial over `done` runs
 *   GET /runs/:id/trace   → stats.cost_usd
 * Every external adapter is mocked (LLM, git, GitHub, secrets), so nothing
 * leaves the disposable Testcontainers database.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A provider that always fails → the run ends `failed` (spec T3). */
class FailingLLMProvider extends MockLLMProvider {
  override async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('provider down');
  }
}

type PrListItem = { id: string; cost_usd?: number | null; cost_partial?: boolean };

d('L01 cost read paths (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(llm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient({ pulls: [] }),
        git: new MockGitClient({ diff: DIFF }),
        embedder: new MockEmbedder(),
        llm: { openai: llm },
      },
    });
  }

  async function newRepoAndPr() {
    const name = `cost-api-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  async function newAgent(app: FastifyInstance): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: `Cost ${seq++}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id;
  }

  /** Run one review with `llm` and wait until `expectedRuns` runs of the PR settled. */
  async function review(llm: MockLLMProvider, prId: string, expectedRuns: number): Promise<string> {
    const app = await appWith(llm);
    const agentId = await newAgent(app);
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    expect(res.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, prId, { expected: expectedRuns });
    await app.close();
    return res.json().runs[0].run_id as string;
  }

  async function read(repoId: string, prId: string) {
    const app = await appWith(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }));
    const runsRes = await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` });
    const pullsRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(runsRes.statusCode).toBe(200);
    expect(pullsRes.statusCode).toBe(200);
    const runs = runsRes.json() as RunSummary[];
    const pr = (pullsRes.json() as PrListItem[]).find((p) => p.id === prId)!;
    const trace = async (runId: string) =>
      (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    return { app, runs, pr, trace };
  }

  it('T1: a successful run exposes its cost in the run list, the trace and the PR total', async () => {
    const { repo, pr } = await newRepoAndPr();
    const runId = await review(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }), pr.id, 1);

    const r = await read(repo.id, pr.id);
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ run_id: runId, status: 'done', cost_usd: 0.001 });
    expect((await r.trace(runId)).stats.cost_usd).toBe(0.001);
    expect(r.pr).toMatchObject({ cost_usd: 0.001, cost_partial: false });
    await r.app.close();
  });

  it('T2: unknown cost stays null everywhere (never 0) and makes the PR total partial', async () => {
    const { repo, pr } = await newRepoAndPr();
    const runId = await review(new CostLLMProvider(null), pr.id, 1);

    const r = await read(repo.id, pr.id);
    expect(r.runs[0]!.status).toBe('done');
    expect(r.runs[0]).toHaveProperty('cost_usd', null);
    expect((await r.trace(runId)).stats).toHaveProperty('cost_usd', null);
    expect(r.pr).toMatchObject({ cost_usd: null, cost_partial: true });
    await r.app.close();
  });

  it('known zero cost stays 0 (not null) in the run list and the PR total', async () => {
    const { repo, pr } = await newRepoAndPr();
    await review(new CostLLMProvider(0), pr.id, 1);

    const r = await read(repo.id, pr.id);
    expect(r.runs[0]!.cost_usd).toBe(0);
    expect(r.pr).toMatchObject({ cost_usd: 0, cost_partial: false });
    await r.app.close();
  });

  it('T3+T4: two done runs are summed; a failed run has null cost and is excluded', async () => {
    const { repo, pr } = await newRepoAndPr();
    const mock = () => new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    await review(mock(), pr.id, 1);
    await review(mock(), pr.id, 2);
    const failedId = await review(new FailingLLMProvider('openai'), pr.id, 3);

    const r = await read(repo.id, pr.id);
    const failed = r.runs.find((x) => x.run_id === failedId)!;
    expect(failed.status).toBe('failed');
    expect(failed).toHaveProperty('cost_usd', null);
    expect(r.runs.filter((x) => x.status === 'done').map((x) => x.cost_usd)).toEqual([0.001, 0.001]);
    expect(r.pr.cost_usd).toBeCloseTo(0.002, 10);
    expect(r.pr.cost_partial).toBe(false);
    await r.app.close();
  });

  it('T5: a PR with no runs has an unknown, non-partial cost', async () => {
    const { repo, pr } = await newRepoAndPr();
    const r = await read(repo.id, pr.id);
    expect(r.runs).toEqual([]);
    expect(r.pr).toMatchObject({ cost_usd: null, cost_partial: false });
    await r.app.close();
  });

  it('T6: an old trace without stats.cost_usd lists as null (no 500) and makes the total partial', async () => {
    const { repo, pr } = await newRepoAndPr();
    await review(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }), pr.id, 1);
    // A pre-L01 run: done, with a trace document that never had the key.
    const [old] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'done', provider: 'openai', model: 'gpt-4.1', source: 'local' })
      .returning();
    await pg.handle.db.insert(t.runTraces).values({
      runId: old!.id,
      trace: {
        config: { agent: 'Legacy', model: 'gpt-4.1', source: 'local' },
        stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed' },
        prompt_assembly: { system: 's', user: 'u' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });

    const r = await read(repo.id, pr.id);
    expect(r.runs.find((x) => x.run_id === old!.id)).toHaveProperty('cost_usd', null);
    expect(r.pr).toMatchObject({ cost_usd: 0.001, cost_partial: true });
    await r.app.close();
  });

  it('a running run without a trace yet reads null and is not counted', async () => {
    const { repo, pr } = await newRepoAndPr();
    await review(new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }), pr.id, 1);
    const [running] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, status: 'running', provider: 'openai', model: 'gpt-4.1', source: 'local' })
      .returning();

    const r = await read(repo.id, pr.id);
    expect(r.runs.find((x) => x.run_id === running!.id)).toHaveProperty('cost_usd', null);
    expect(r.pr).toMatchObject({ cost_usd: 0.001, cost_partial: false });
    await r.app.close();
  });

  it('T7: DELETE /runs/:id drops that run from the total; DELETE /reviews/:id does not', async () => {
    const { repo, pr } = await newRepoAndPr();
    const mock = () => new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const first = await review(mock(), pr.id, 1);
    await review(mock(), pr.id, 2);

    const before = await read(repo.id, pr.id);
    expect(before.pr.cost_usd).toBeCloseTo(0.002, 10);

    // Deleting a review keeps the run row → its spend is still counted.
    const reviews = (await before.app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const reviewOfSecond = reviews.find((rv: { run_id: string }) => rv.run_id !== first);
    expect((await before.app.inject({ method: 'DELETE', url: `/reviews/${reviewOfSecond.id}` })).statusCode).toBe(200);
    const afterReviewDelete = await read(repo.id, pr.id);
    expect(afterReviewDelete.pr.cost_usd).toBeCloseTo(0.002, 10);

    // Deleting a run removes the run and (FK cascade) its trace → total drops.
    expect((await before.app.inject({ method: 'DELETE', url: `/runs/${first}` })).statusCode).toBe(200);
    const after = await read(repo.id, pr.id);
    expect(after.pr.cost_usd).toBeCloseTo(0.001, 10);
    expect(after.pr.cost_partial).toBe(false);

    await before.app.close();
    await afterReviewDelete.app.close();
    await after.app.close();
  });
});
