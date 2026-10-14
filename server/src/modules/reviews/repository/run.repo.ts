import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding, RunSummary, RunTrace } from '@devdigest/shared';
import type { FindingRow } from '../../../db/rows.js';
import { toCostUsd, traceCostUsd } from '../../../db/trace-cost.js';
import { insertFindings, insertReview, type ReviewRow } from './review.repo.js';
import { markReviewed } from './pull.repo.js';

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. Cost is
 *  extracted from each run's trace in the same query (LEFT JOIN, no N+1). */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name, costUsd: traceCostUsd() })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName, costUsd }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
    // null = unknown (no trace yet, old trace without the key, or unknown cost).
    cost_usd: toCostUsd(costUsd),
  }));
}

/**
 * Delete one agent run (+ its trace via FK cascade) AND the review it produced.
 * Workspace-scoped. `reviews.run_id` has no FK to `agent_runs`, so the review
 * (and its findings, which DO cascade from `reviews`) must be removed explicitly
 * here — otherwise deleting a run from the timeline leaves its findings orphaned
 * in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: Db, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: Db,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: Db,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: Db, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

export async function getRunTrace(db: Db, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  return row ? (row.trace as RunTrace) : undefined;
}

// ---- L01 Step 2: transactional success + guarded terminal writes ----------
// See specs/review-run-cost.md §3.3–§3.7.

export interface FinalizeDoneRunInput {
  runId: string;
  review: Parameters<typeof insertReview>[1];
  /** Grounded findings; inserted 1:1, so `completion.findingsCount` = length. */
  findings: Finding[];
  reviewedSha: { prId: string; sha: string };
  completion: {
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    findingsCount: number;
    grounding: string;
    score: number | null;
    blockers: number | null;
  };
  /** Built before the call; `stats.cost_usd` carries reviewer-core's figure as is. */
  trace: RunTrace;
}

export type FinalizeDoneRunResult =
  | { finalized: true; review: ReviewRow; findings: FindingRow[] }
  /** `currentStatus` null = the agent_runs row no longer exists. */
  | { finalized: false; currentStatus: string | null };

/**
 * Atomically turn a `running` run into `done` together with its review,
 * findings, `last_reviewed_sha` and trace. The claim goes first and is guarded
 * by `status = 'running'`, so a run cancelled (or deleted) before it is never
 * finalized; any later failure rolls everything back, including the claim.
 */
export async function finalizeDoneRun(
  db: Db,
  input: FinalizeDoneRunInput,
): Promise<FinalizeDoneRunResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(t.agentRuns)
      .set({
        status: 'done',
        durationMs: input.completion.durationMs,
        tokensIn: input.completion.tokensIn,
        tokensOut: input.completion.tokensOut,
        findingsCount: input.completion.findingsCount,
        grounding: input.completion.grounding,
        score: input.completion.score,
        blockers: input.completion.blockers,
        error: null,
      })
      .where(and(eq(t.agentRuns.id, input.runId), eq(t.agentRuns.status, 'running')))
      .returning({ id: t.agentRuns.id });
    if (claimed.length === 0) {
      const current = await getRunStatus(tx, input.runId);
      return { finalized: false, currentStatus: current ? current.status : null };
    }
    const review = await insertReview(tx, input.review);
    const findings = await insertFindings(tx, review.id, input.findings);
    await markReviewed(tx, input.reviewedSha.prId, input.reviewedSha.sha);
    await saveRunTrace(tx, input.runId, input.trace);
    return { finalized: true, review, findings };
  });
}

/** `running` → `failed`. Never touches a run that already reached a terminal state. */
export async function recordRunFailed(
  db: Db,
  runId: string,
  values: { durationMs: number; error: string },
): Promise<'transitioned' | 'noop'> {
  const rows = await db
    .update(t.agentRuns)
    .set({
      status: 'failed',
      durationMs: values.durationMs,
      tokensIn: 0,
      tokensOut: 0,
      findingsCount: 0,
      grounding: '0/0 passed',
      score: null,
      blockers: null,
      error: values.error,
    })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0 ? 'transitioned' : 'noop';
}

export const CANCELLED_BY_USER = 'Cancelled by user';

/**
 * Record a cancellation. A: `running` → `cancelled` with its metadata.
 * B (only if A matched nothing): fill the metadata of a run that
 * `cancelRunIfRunning` already cancelled (it sets only `status`), WITHOUT
 * writing `status`, and only once (`error IS NULL`). A must run before B.
 */
export async function recordRunCancelled(
  db: Db,
  runId: string,
  values: { durationMs: number },
): Promise<'transitioned' | 'annotated' | 'noop'> {
  const metadata = {
    durationMs: values.durationMs,
    tokensIn: 0,
    tokensOut: 0,
    findingsCount: 0,
    grounding: '0/0 passed',
    score: null,
    blockers: null,
    error: CANCELLED_BY_USER,
  };
  const transitioned = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled', ...metadata })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  if (transitioned.length > 0) return 'transitioned';
  const annotated = await db
    .update(t.agentRuns)
    .set(metadata)
    .where(
      and(
        eq(t.agentRuns.id, runId),
        eq(t.agentRuns.status, 'cancelled'),
        isNull(t.agentRuns.error),
      ),
    )
    .returning({ id: t.agentRuns.id });
  return annotated.length > 0 ? 'annotated' : 'noop';
}

/** Insert a trace only if the run has none, so a committed trace is never replaced. */
export async function insertRunTraceIfAbsent(
  db: Db,
  runId: string,
  trace: RunTrace,
): Promise<boolean> {
  const rows = await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoNothing({ target: t.runTraces.runId })
    .returning({ runId: t.runTraces.runId });
  return rows.length > 0;
}

/** Current status of a run; undefined when the row no longer exists. */
export async function getRunStatus(
  db: Db,
  runId: string,
): Promise<{ status: string | null } | undefined> {
  const [row] = await db
    .select({ status: t.agentRuns.status })
    .from(t.agentRuns)
    .where(eq(t.agentRuns.id, runId));
  return row;
}

/**
 * Run `fn` in its own transaction with `lock_timeout` and `statement_timeout`
 * set via `SET LOCAL`, so they end with the transaction and never leak into the
 * pool. Bounds reconciliation writes that could otherwise wait on a row lock
 * held by a transaction whose client already gave up (an ambiguous commit).
 */
export async function withLocalTimeouts<T>(
  db: Db,
  timeoutMs: number,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const ms = Math.max(1, Math.floor(timeoutMs));
  return db.transaction(async (tx) => {
    // SET does not take bind parameters; `ms` is a validated integer.
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${ms}ms'`));
    await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${ms}ms'`));
    return fn(tx);
  });
}
