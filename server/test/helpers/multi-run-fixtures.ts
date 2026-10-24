import type { Finding } from '@devdigest/shared';
import * as t from '../../src/db/schema.js';
import { ReviewRepository } from '../../src/modules/reviews/repository.js';
import type { PgFixture } from './pg.js';

/**
 * L07 T12 — direct DB fixtures for multi-agent integration tests. Everything
 * is written into the per-file Testcontainers Postgres (never a working DB).
 */
type Db = PgFixture['handle']['db'];
let seq = 0;
const next = () => ++seq;

export async function newWorkspace(db: Db, name = `ws-${next()}`): Promise<string> {
  const [ws] = await db.insert(t.workspaces).values({ name }).returning();
  return ws!.id;
}

export async function newRepoAndPr(db: Db, workspaceId: string, number = 482) {
  const name = `repo-${next()}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number,
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

export async function newAgent(db: Db, workspaceId: string, name = `Agent ${next()}`, model = 'gpt-4.1') {
  const [a] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openai', model, systemPrompt: 'review', enabled: true })
    .returning();
  return a!;
}

export async function newRun(
  db: Db,
  v: {
    workspaceId: string;
    agentId: string | null;
    prId: string | null;
    status?: string;
    source?: 'local' | 'ci';
    durationMs?: number | null;
    ranAt?: Date;
    multiAgentRunId?: string | null;
    error?: string | null;
    score?: number | null;
  },
) {
  const [r] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: v.workspaceId,
      agentId: v.agentId,
      prId: v.prId,
      status: v.status ?? 'done',
      source: v.source ?? 'local',
      durationMs: v.durationMs === undefined ? 1000 : v.durationMs,
      ...(v.ranAt ? { ranAt: v.ranAt } : {}),
      multiAgentRunId: v.multiAgentRunId ?? null,
      error: v.error ?? null,
      score: v.score ?? null,
      provider: 'openai',
      model: 'gpt-4.1',
    })
    .returning();
  return r!;
}

/** A run trace carrying only what the read paths use (stats.cost_usd). */
export async function addTrace(db: Db, runId: string, costUsd: number | null) {
  await db.insert(t.runTraces).values({ runId, trace: { stats: { cost_usd: costUsd } } });
}

export function finding(o: Partial<Finding> & Pick<Finding, 'file' | 'start_line'>): Finding {
  return {
    id: `f-${next()}`,
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${seq}`,
    end_line: o.start_line,
    rationale: 'why',
    suggestion: 'fix',
    confidence: 0.9,
    kind: 'finding',
    ...o,
  };
}

/** A review for a run plus its findings (via the production repository). */
export async function addReview(
  db: Db,
  v: { workspaceId: string; prId: string; agentId: string | null; runId: string },
  findings: Finding[] = [],
  extra: { verdict?: string; summary?: string; score?: number } = {},
) {
  const repo = new ReviewRepository(db);
  const review = await repo.insertReview({
    workspaceId: v.workspaceId,
    prId: v.prId,
    agentId: v.agentId,
    runId: v.runId,
    kind: 'review',
    verdict: extra.verdict ?? 'comment',
    summary: extra.summary ?? 'summary',
    score: extra.score ?? 70,
    model: 'gpt-4.1',
  });
  const rows = findings.length > 0 ? await repo.insertFindings(review.id, findings) : [];
  return { review, findings: rows };
}

export async function newMultiRun(db: Db, workspaceId: string, prId: string, ranAt = new Date()) {
  const [m] = await db.insert(t.multiAgentRuns).values({ workspaceId, prId, ranAt }).returning();
  return m!;
}
