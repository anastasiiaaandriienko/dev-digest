import { and, asc, desc, eq, lt, notInArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { AgentEvalRunRow, EvalRunRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';

/**
 * `agent_eval_runs` (one row per run) and `eval_runs` (one row per case per run)
 * data access. `eval_runs` has no workspace column: it is only ever reached
 * through its run, which is scoped by `workspace_id`.
 */

export type AgentEvalRunInsert = typeof t.agentEvalRuns.$inferInsert;
export type EvalRunInsert = typeof t.evalRuns.$inferInsert;

/** Runs of one agent, newest first (a builder, so unit tests can read `.toSQL()`). */
export function buildListAgentEvalRunsQuery(db: Db, workspaceId: string, agentId: string, limit: number) {
  return db
    .select()
    .from(t.agentEvalRuns)
    .where(and(eq(t.agentEvalRuns.workspaceId, workspaceId), eq(t.agentEvalRuns.agentId, agentId)))
    .orderBy(desc(t.agentEvalRuns.startedAt), desc(t.agentEvalRuns.id))
    .limit(limit);
}

export async function listAgentEvalRuns(
  db: Db,
  workspaceId: string,
  agentId: string,
  limit: number,
): Promise<AgentEvalRunRow[]> {
  return buildListAgentEvalRunsQuery(db, workspaceId, agentId, limit);
}

export async function getAgentEvalRun(db: Db, workspaceId: string, id: string): Promise<AgentEvalRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.agentEvalRuns)
    .where(and(eq(t.agentEvalRuns.workspaceId, workspaceId), eq(t.agentEvalRuns.id, id)));
  return row;
}

export async function insertAgentEvalRun(db: Db, values: AgentEvalRunInsert): Promise<AgentEvalRunRow> {
  const [row] = await db.insert(t.agentEvalRuns).values(values).returning();
  return row!;
}

export async function insertEvalCaseResult(db: Db, values: EvalRunInsert): Promise<EvalRunRow> {
  const [row] = await db.insert(t.evalRuns).values(values).returning();
  return row!;
}

/** Per-case results of one run, scoped through the run's workspace (a builder for `.toSQL()`). */
export function buildListEvalCaseResultsQuery(db: Db, workspaceId: string, suiteRunId: string) {
  return db
    .select({ result: t.evalRuns })
    .from(t.evalRuns)
    .innerJoin(t.agentEvalRuns, eq(t.agentEvalRuns.id, t.evalRuns.suiteRunId))
    .where(and(eq(t.agentEvalRuns.workspaceId, workspaceId), eq(t.evalRuns.suiteRunId, suiteRunId)))
    .orderBy(asc(t.evalRuns.ranAt), asc(t.evalRuns.id));
}

export async function listEvalCaseResults(db: Db, workspaceId: string, suiteRunId: string): Promise<EvalRunRow[]> {
  const rows = await buildListEvalCaseResultsQuery(db, workspaceId, suiteRunId);
  return rows.map((r) => r.result);
}

/** Terminal fields written when a run ends (spec §9). */
export interface AgentEvalRunFinalValues {
  status: 'done' | 'failed';
  error: string | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  counts: unknown;
  costUsd: number | null;
  durationMs: number | null;
}

/**
 * Finish a run atomically: the run row is updated ONLY while it is still
 * `running` (a reaped / failed run is never overwritten), and its per-case rows
 * are inserted in the same transaction. Returns false when the run was no longer
 * running — then nothing is written.
 */
export async function finalizeAgentEvalRun(
  db: Db,
  runId: string,
  final: AgentEvalRunFinalValues,
  rows: EvalRunInsert[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(t.agentEvalRuns)
      .set({ ...final, finishedAt: new Date() })
      .where(and(eq(t.agentEvalRuns.id, runId), eq(t.agentEvalRuns.status, 'running')))
      .returning({ id: t.agentEvalRuns.id });
    if (updated.length === 0) return false;
    if (rows.length > 0) await tx.insert(t.evalRuns).values(rows);
    return true;
  });
}

/** Mark one run failed (guarded: only while `running`). */
export async function failAgentEvalRun(db: Db, runId: string, error: string): Promise<boolean> {
  const rows = await db
    .update(t.agentEvalRuns)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(and(eq(t.agentEvalRuns.id, runId), eq(t.agentEvalRuns.status, 'running')))
    .returning({ id: t.agentEvalRuns.id });
  return rows.length > 0;
}

/** Which runs `failRunningAgentEvalRuns` may fail besides "all running" (boot). */
export interface StaleRunScope {
  agentId: string;
  startedBefore: Date;
  /** Runs still executing in this process — never stale, however long they take. */
  excludeIds?: readonly string[];
}

/**
 * Fail `running` runs: all of them (boot — runs live only inside the process that
 * started them), or, with a scope, the stale ones of one agent: started before the
 * cutoff AND not executing in this process (`excludeIds`).
 */
export async function failRunningAgentEvalRuns(db: Db, error: string, scope?: StaleRunScope): Promise<number> {
  const excluded = scope?.excludeIds?.length ? [notInArray(t.agentEvalRuns.id, [...scope.excludeIds])] : [];
  const rows = await db
    .update(t.agentEvalRuns)
    .set({ status: 'failed', error, finishedAt: new Date() })
    .where(
      scope
        ? and(
            eq(t.agentEvalRuns.status, 'running'),
            eq(t.agentEvalRuns.agentId, scope.agentId),
            lt(t.agentEvalRuns.startedAt, scope.startedBefore),
            ...excluded,
          )
        : eq(t.agentEvalRuns.status, 'running'),
    )
    .returning({ id: t.agentEvalRuns.id });
  return rows.length;
}

/** The agent's `running` run, if any (at most one: `agent_eval_runs_one_running_uq`). */
export async function getRunningAgentEvalRun(
  db: Db,
  workspaceId: string,
  agentId: string,
): Promise<AgentEvalRunRow | undefined> {
  const [row] = await db
    .select()
    .from(t.agentEvalRuns)
    .where(
      and(
        eq(t.agentEvalRuns.workspaceId, workspaceId),
        eq(t.agentEvalRuns.agentId, agentId),
        eq(t.agentEvalRuns.status, 'running'),
      ),
    );
  return row;
}

/** Is the run still `running`? (The runner asks before every paid engine call.) */
export async function isAgentEvalRunRunning(db: Db, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: t.agentEvalRuns.status })
    .from(t.agentEvalRuns)
    .where(eq(t.agentEvalRuns.id, runId));
  return row?.status === 'running';
}
