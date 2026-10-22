import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { EvalCaseRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
import type { EvalCaseLastResultRow } from './helpers.js';

/**
 * `eval_cases` data access. Every read is scoped by `workspace_id`; only labeled
 * agent-owned rows (`kind IS NOT NULL`) are part of the L06 pipeline — legacy rows
 * are never selected, updated or deleted here.
 */

export type EvalCaseInsert = typeof t.evalCases.$inferInsert;

/** Labeled cases of one agent, newest first (a builder, so unit tests can read `.toSQL()`). */
export function buildListAgentEvalCasesQuery(db: Db, workspaceId: string, agentId: string) {
  return db
    .select()
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
        isNotNull(t.evalCases.kind),
      ),
    )
    .orderBy(desc(t.evalCases.createdAt), desc(t.evalCases.id));
}

export async function listAgentEvalCases(db: Db, workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
  return buildListAgentEvalCasesQuery(db, workspaceId, agentId);
}

export async function getEvalCase(db: Db, workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalCases)
    .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
  return row;
}

export async function insertEvalCase(db: Db, values: EvalCaseInsert): Promise<EvalCaseRow> {
  const [row] = await db.insert(t.evalCases).values(values).returning();
  return row!;
}

/**
 * Latest L06 result per case (one row per case id). Callers pass ids they already
 * loaded through a workspace-scoped query, so no extra scoping is needed here.
 */
export async function listLastCaseResults(db: Db, caseIds: string[]): Promise<EvalCaseLastResultRow[]> {
  if (caseIds.length === 0) return [];
  const rows = await db
    .selectDistinctOn([t.evalRuns.caseId], {
      caseId: t.evalRuns.caseId,
      suiteRunId: t.evalRuns.suiteRunId,
      outcome: t.evalRuns.outcome,
      ranAt: t.evalRuns.ranAt,
    })
    .from(t.evalRuns)
    .where(and(inArray(t.evalRuns.caseId, caseIds), isNotNull(t.evalRuns.suiteRunId)))
    .orderBy(t.evalRuns.caseId, desc(t.evalRuns.ranAt));
  return rows.flatMap((r) => (r.suiteRunId ? [{ ...r, suiteRunId: r.suiteRunId }] : []));
}

/** The agent's case created from this finding, if any. */
export async function findCaseBySourceFinding(
  db: Db,
  workspaceId: string,
  agentId: string,
  findingId: string,
): Promise<EvalCaseRow | undefined> {
  const [row] = await db
    .select()
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
        eq(t.evalCases.sourceFindingId, findingId),
      ),
    );
  return row;
}

/** The agent's labeled cases on one frozen input (same `input_hash`). */
export async function listAgentCasesByInput(
  db: Db,
  workspaceId: string,
  agentId: string,
  inputHash: string,
): Promise<EvalCaseRow[]> {
  return db
    .select()
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
        eq(t.evalCases.inputHash, inputHash),
        isNotNull(t.evalCases.kind),
      ),
    );
}

/** Every case name the agent already uses (legacy rows included, so names never collide). */
export async function listAgentCaseNames(db: Db, workspaceId: string, agentId: string): Promise<string[]> {
  const rows = await db
    .select({ name: t.evalCases.name })
    .from(t.evalCases)
    .where(
      and(
        eq(t.evalCases.workspaceId, workspaceId),
        eq(t.evalCases.ownerKind, 'agent'),
        eq(t.evalCases.ownerId, agentId),
      ),
    );
  return rows.map((r) => r.name);
}
