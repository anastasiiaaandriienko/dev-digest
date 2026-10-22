import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { AgentEvalRunRow, EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import * as t from '../../db/schema.js';
import * as cases from './eval-case.repo.js';
import * as runs from './eval-run.repo.js';
import type { EvalCaseLastResultRow } from './helpers.js';

export type { EvalCaseInsert } from './eval-case.repo.js';
export type { AgentEvalRunInsert, EvalRunInsert } from './eval-run.repo.js';

/** What `createCaseLocked` hands its `build` callback (read under the lock). */
export interface EvalCaseLockedState {
  existing: EvalCaseRow | undefined;
  sameInput: EvalCaseRow[];
  takenNames: ReadonlySet<string>;
}

/** Minimal agent shape the eval module needs (workspace-scoped lookup). */
export interface EvalAgentRef {
  id: string;
  version: number;
}

/**
 * Eval data-access facade over `eval-case.repo.ts` / `eval-run.repo.ts`. Reads
 * the `agents` table directly (id + version only) instead of importing another
 * module's repository.
 */
export class EvalRepository {
  constructor(private db: Db) {}

  async getAgent(workspaceId: string, agentId: string): Promise<EvalAgentRef | undefined> {
    const [row] = await this.db
      .select({ id: t.agents.id, version: t.agents.version })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row;
  }

  listAgentEvalCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return cases.listAgentEvalCases(this.db, workspaceId, agentId);
  }

  getEvalCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    return cases.getEvalCase(this.db, workspaceId, id);
  }

  insertEvalCase(values: cases.EvalCaseInsert): Promise<EvalCaseRow> {
    return cases.insertEvalCase(this.db, values);
  }

  /**
   * Create a case atomically (spec §7.5). One transaction holds a per-agent
   * advisory lock, so concurrent creations for the same agent run one after the
   * other: each sees the cases committed before it (same finding, same location,
   * taken names) and `build` decides on that state — it returns the row to insert
   * or throws to abort. The partial unique index `eval_cases_owner_finding_uq` is
   * the last line of defence for "one case per finding".
   */
  createCaseLocked(
    scope: { workspaceId: string; agentId: string; inputHash: string; findingId: string },
    build: (state: EvalCaseLockedState) => cases.EvalCaseInsert,
  ): Promise<EvalCaseRow> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`eval_case:${scope.agentId}`}, 0))`);
      const existing = await cases.findCaseBySourceFinding(tx, scope.workspaceId, scope.agentId, scope.findingId);
      const sameInput = await cases.listAgentCasesByInput(tx, scope.workspaceId, scope.agentId, scope.inputHash);
      const takenNames = new Set(await cases.listAgentCaseNames(tx, scope.workspaceId, scope.agentId));
      return cases.insertEvalCase(tx, build({ existing, sameInput, takenNames }));
    });
  }

  /** Agent version recorded in a review run's trace (`config.version`), if any. */
  async agentVersionOfRun(runId: string | null): Promise<number | null> {
    if (!runId) return null;
    const [row] = await this.db
      .select({ version: sql<string | null>`${t.runTraces.trace}->'config'->>'version'` })
      .from(t.runTraces)
      .where(eq(t.runTraces.runId, runId));
    const n = row?.version == null ? NaN : Number(row.version);
    return Number.isInteger(n) ? n : null;
  }

  listLastCaseResults(caseIds: string[]): Promise<EvalCaseLastResultRow[]> {
    return cases.listLastCaseResults(this.db, caseIds);
  }

  listAgentEvalRuns(workspaceId: string, agentId: string, limit: number): Promise<AgentEvalRunRow[]> {
    return runs.listAgentEvalRuns(this.db, workspaceId, agentId, limit);
  }

  getAgentEvalRun(workspaceId: string, id: string): Promise<AgentEvalRunRow | undefined> {
    return runs.getAgentEvalRun(this.db, workspaceId, id);
  }

  insertAgentEvalRun(values: runs.AgentEvalRunInsert): Promise<AgentEvalRunRow> {
    return runs.insertAgentEvalRun(this.db, values);
  }

  insertEvalCaseResult(values: runs.EvalRunInsert): Promise<EvalRunRow> {
    return runs.insertEvalCaseResult(this.db, values);
  }

  listEvalCaseResults(workspaceId: string, suiteRunId: string): Promise<EvalRunRow[]> {
    return runs.listEvalCaseResults(this.db, workspaceId, suiteRunId);
  }

  getRunningAgentEvalRun(workspaceId: string, agentId: string): Promise<AgentEvalRunRow | undefined> {
    return runs.getRunningAgentEvalRun(this.db, workspaceId, agentId);
  }

  finalizeAgentEvalRun(runId: string, final: runs.AgentEvalRunFinalValues, rows: runs.EvalRunInsert[]): Promise<boolean> {
    return runs.finalizeAgentEvalRun(this.db, runId, final, rows);
  }

  failAgentEvalRun(runId: string, error: string): Promise<boolean> {
    return runs.failAgentEvalRun(this.db, runId, error);
  }

  failRunningAgentEvalRuns(error: string, scope?: runs.StaleRunScope): Promise<number> {
    return runs.failRunningAgentEvalRuns(this.db, error, scope);
  }

  isAgentEvalRunRunning(runId: string): Promise<boolean> {
    return runs.isAgentEvalRunRunning(this.db, runId);
  }
}
