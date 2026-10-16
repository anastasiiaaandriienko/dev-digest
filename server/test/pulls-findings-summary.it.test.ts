import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { PrMeta } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * L01 — PR-list FINDINGS over HTTP: GET /repos/:id/pulls → PrMeta.findings_summary
 * counts the latest COMPLETED review of each agent (failed / running runs and
 * older reviews of the same agent are ignored). Rows are inserted directly so
 * the selection rule is tested without the LLM pipeline; GitHub and secrets are
 * mocked so nothing leaves the disposable database.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('L01 PR-list findings summary (Testcontainers pg)', () => {
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

  async function newRepoAndPr() {
    const name = `findings-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1000 + seq,
        title: 'Findings summary',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repoId: repo!.id, prId: pr!.id };
  }

  async function newAgent(name: string): Promise<string> {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: `${name} ${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review' })
      .returning();
    return agent!.id;
  }

  /** A review (with its run in `status`, or no run) and findings of the given severities. */
  async function addReview(
    prId: string,
    agentId: string | null,
    minute: number,
    severities: string[],
    status: 'done' | 'failed' | 'running' | null = 'done',
  ): Promise<string> {
    const db = pg.handle.db;
    let runId: string | null = null;
    if (status) {
      const [run] = await db.insert(t.agentRuns).values({ workspaceId, agentId, prId, status }).returning();
      runId = run!.id;
    }
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId,
        runId,
        kind: 'review',
        verdict: 'comment',
        score: 70,
        createdAt: new Date(Date.UTC(2026, 9, 11, 10, minute)),
      })
      .returning();
    if (severities.length > 0) {
      await db.insert(t.findings).values(
        severities.map((severity, i) => ({
          reviewId: review!.id,
          file: 'src/a.ts',
          startLine: i + 1,
          endLine: i + 1,
          severity,
          category: 'bug',
          title: `${severity} ${i}`,
          rationale: 'r',
          confidence: 0.9,
        })),
      );
    }
    return review!.id;
  }

  async function list(repoId: string, prId: string): Promise<PrMeta> {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), github: new MockGitHubClient({ pulls: [] }) },
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    await app.close();
    expect(res.statusCode).toBe(200);
    return (res.json() as PrMeta[]).find((p) => p.id === prId)!;
  }

  it('F1: a PR without reviews has findings_summary null', async () => {
    const { repoId, prId } = await newRepoAndPr();
    expect((await list(repoId, prId)).findings_summary).toBeNull();
  });

  it('F2: two agents → both latest reviews counted, with a per-agent breakdown', async () => {
    const { repoId, prId } = await newRepoAndPr();
    const sec = await newAgent('Security');
    const perf = await newAgent('Performance');
    const secReview = await addReview(prId, sec, 1, ['CRITICAL', 'WARNING']);
    const perfReview = await addReview(prId, perf, 2, ['SUGGESTION']);

    const summary = (await list(repoId, prId)).findings_summary!;
    expect(summary.total).toBe(3);
    expect(summary.counts).toEqual({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1, INFO: 0 });
    expect(summary.agents.map((a) => a.review_id)).toEqual([perfReview, secReview]);
    expect(summary.agents[1]).toMatchObject({ agent_id: sec, total: 2, counts: { CRITICAL: 1, WARNING: 1 } });
    expect(summary.agents[1]!.agent_name).toMatch(/^Security/);
  });

  it('F3: re-running one agent replaces its earlier result (no double counting)', async () => {
    const { repoId, prId } = await newRepoAndPr();
    const sec = await newAgent('Security');
    await addReview(prId, sec, 1, ['CRITICAL', 'CRITICAL', 'WARNING']);
    const latest = await addReview(prId, sec, 5, ['WARNING']);

    const summary = (await list(repoId, prId)).findings_summary!;
    expect(summary.agents).toHaveLength(1);
    expect(summary.agents[0]!.review_id).toBe(latest);
    expect(summary).toMatchObject({ total: 1, counts: { CRITICAL: 0, WARNING: 1 } });
  });

  it('F4: reviews of failed or running runs are ignored; the agent keeps its last completed one', async () => {
    const { repoId, prId } = await newRepoAndPr();
    const sec = await newAgent('Security');
    const done = await addReview(prId, sec, 1, ['CRITICAL']);
    await addReview(prId, sec, 3, ['WARNING', 'WARNING'], 'failed');
    await addReview(prId, sec, 4, ['SUGGESTION'], 'running');

    const summary = (await list(repoId, prId)).findings_summary!;
    expect(summary.agents.map((a) => a.review_id)).toEqual([done]);
    expect(summary).toMatchObject({ total: 1, counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 } });
  });

  it('F5: only incomplete reviews → null; an agent with zero findings is listed with zeros', async () => {
    const a = await newRepoAndPr();
    const sec = await newAgent('Security');
    await addReview(a.prId, sec, 1, ['CRITICAL'], 'failed');
    expect((await list(a.repoId, a.prId)).findings_summary).toBeNull();

    const b = await newRepoAndPr();
    const clean = await addReview(b.prId, sec, 1, []);
    const summary = (await list(b.repoId, b.prId)).findings_summary!;
    expect(summary).toMatchObject({ total: 0, counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 } });
    expect(summary.agents).toEqual([expect.objectContaining({ review_id: clean, total: 0 })]);
  });

  it('F6: a review without a run (seeded) counts; summary reviews are ignored', async () => {
    const { repoId, prId } = await newRepoAndPr();
    const seeded = await addReview(prId, null, 1, ['CRITICAL'], null);
    await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'summary', summary: 'brief', createdAt: new Date(Date.UTC(2026, 9, 11, 11)) });

    const summary = (await list(repoId, prId)).findings_summary!;
    expect(summary.agents).toEqual([expect.objectContaining({ review_id: seeded, agent_id: null, agent_name: null })]);
    expect(summary.total).toBe(1);
  });

  it('F7: cost and score are unchanged by the summary', async () => {
    const { repoId, prId } = await newRepoAndPr();
    const sec = await newAgent('Security');
    await addReview(prId, sec, 1, ['CRITICAL']);
    const pr = await list(repoId, prId);
    expect(pr.score).toBe(70);
    expect(pr).toHaveProperty('cost_usd');
    expect(pr).toHaveProperty('cost_partial');
  });
});
