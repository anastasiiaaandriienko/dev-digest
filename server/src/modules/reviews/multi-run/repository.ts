import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { FindingRow } from '../../../db/rows.js';
import { toCostUsd, traceCostUsd } from '../../../db/trace-cost.js';
import { evalCaseIdsForFindings, findingsForReviews, type ReviewRow } from '../repository/review.repo.js';

/** An agent as needed to queue its run (a subset of AgentRow). */
export type MultiRunAgent = { id: string; provider: string | null; model: string | null };

/** Estimates use each agent's last N `done` local runs (AC-MAR-19, spec Q7). */
export const ESTIMATE_WINDOW = 10;

/**
 * One row per workspace agent × one of its last ESTIMATE_WINDOW `done` local
 * runs (`rn` 1 = newest). An agent with no such run yields ONE row with
 * `rn: null` (LEFT JOIN), so it is still listed.
 */
export type EstimateRunRow = {
  agentId: string;
  rn: number | null;
  durationMs: number | null;
  costUsd: number | null;
};

/** A linked child run with its agent name and trace cost (null = unknown). */
export type ChildRunRow = {
  run: typeof t.agentRuns.$inferSelect;
  agentName: string | null;
  costUsd: number | null;
};

/**
 * L07 multi-agent run data-access: the `multi_agent_runs` parent and its
 * linked child `agent_runs` (`multi_agent_run_id`, migration 0016).
 */
export class MultiRunRepository {
  constructor(private db: Db) {}

  /**
   * Create the parent and one `running` child per agent in ONE transaction:
   * a failure in any insert rolls everything back, so a request leaves either
   * the whole multi-run or nothing. Children get `ran_at = t0 + i ms` (i = list
   * position): inside a transaction `now()` is the same for every row, which
   * would make column order fall back to the random run id (AC-MAR-53).
   * Returns the child run ids in `agents` order. Do not await slow I/O here.
   */
  async createMultiRun(input: {
    workspaceId: string;
    prId: string;
    agents: readonly MultiRunAgent[];
    startedAt?: Date;
  }): Promise<{ multiAgentRunId: string; runIds: string[] }> {
    if (input.agents.length === 0) throw new Error('createMultiRun: no agents');
    const t0 = input.startedAt ?? new Date();
    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .insert(t.multiAgentRuns)
        .values({ workspaceId: input.workspaceId, prId: input.prId, ranAt: t0 })
        .returning({ id: t.multiAgentRuns.id });
      const children = await tx
        .insert(t.agentRuns)
        .values(
          input.agents.map((agent, i) => ({
            workspaceId: input.workspaceId,
            agentId: agent.id,
            prId: input.prId,
            provider: agent.provider,
            model: agent.model,
            status: 'running',
            source: 'local' as const,
            multiAgentRunId: parent!.id,
            ranAt: new Date(t0.getTime() + i),
          })),
        )
        .returning({ id: t.agentRuns.id, agentId: t.agentRuns.agentId });
      // Map back by agent (ids are distinct after normalizeAgentIds) instead of
      // trusting RETURNING order.
      const runIdByAgent = new Map(children.map((c) => [c.agentId, c.id]));
      const runIds = input.agents.map((agent) => {
        const runId = runIdByAgent.get(agent.id);
        if (!runId) throw new Error(`createMultiRun: no run created for agent ${agent.id}`);
        return runId;
      });
      return { multiAgentRunId: parent!.id, runIds };
    });
  }

  // ---- reads (never write) ------------------------------------------------

  /** The PR's newest multi-run in the workspace (ran_at desc, id desc), if any. */
  async latestForPull(
    workspaceId: string,
    prId: string,
  ): Promise<typeof t.multiAgentRuns.$inferSelect | undefined> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
      .limit(1);
    return row;
  }

  /**
   * Child runs linked to the multi-run (AC-MAR-55: only rows whose
   * `multi_agent_run_id` matches — unlinked and CI rows never appear), with the
   * agent name and the trace cost in the same query; ordered ran_at, id (53).
   */
  async childrenOf(workspaceId: string, multiAgentRunId: string): Promise<ChildRunRow[]> {
    const rows = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name, costUsd: traceCostUsd() })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.multiAgentRunId, multiAgentRunId)))
      .orderBy(asc(t.agentRuns.ranAt), asc(t.agentRuns.id));
    return rows.map(({ run, agentName, costUsd }) => ({
      run,
      agentName: agentName ?? null,
      costUsd: toCostUsd(costUsd),
    }));
  }

  /** Reviews produced by the given runs (workspace-scoped) with their findings. */
  async reviewsForRuns(
    workspaceId: string,
    runIds: readonly string[],
  ): Promise<{ reviews: ReviewRow[]; findings: FindingRow[] }> {
    if (runIds.length === 0) return { reviews: [], findings: [] };
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, [...runIds])))
      .orderBy(desc(t.reviews.createdAt));
    const findings = await findingsForReviews(this.db, reviews.map((r) => r.id));
    return { reviews, findings };
  }

  /** finding id → eval case id created from it (workspace-scoped). */
  evalCaseIdsForFindings(workspaceId: string, findingIds: string[]): Promise<Map<string, string>> {
    return evalCaseIdsForFindings(this.db, workspaceId, findingIds);
  }

  /**
   * The estimate input in ONE query (no N+1, at most ESTIMATE_WINDOW rows per
   * agent): a window over the workspace's `done`, `source='local'` runs
   * (CI runs never count — AC-MAR-56; `pr_id` may be NULL), numbered per agent
   * newest first, LEFT JOINed onto every agent of the workspace. Cost comes
   * from the run's trace (null = unknown). Exposed for `.toSQL()` checks.
   */
  estimateRowsQuery(workspaceId: string) {
    const recent = this.db
      .select({
        agentId: t.agentRuns.agentId,
        durationMs: t.agentRuns.durationMs,
        costUsd: traceCostUsd().as('cost_usd'),
        rn: sql<number>`row_number() over (partition by ${t.agentRuns.agentId} order by ${t.agentRuns.ranAt} desc, ${t.agentRuns.id} desc)`.as(
          'rn',
        ),
      })
      .from(t.agentRuns)
      .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
          eq(t.agentRuns.source, 'local'),
          isNotNull(t.agentRuns.agentId),
        ),
      )
      .as('recent_runs');
    return this.db
      .select({ agentId: t.agents.id, rn: recent.rn, durationMs: recent.durationMs, costUsd: recent.costUsd })
      .from(t.agents)
      .leftJoin(recent, and(eq(recent.agentId, t.agents.id), lte(recent.rn, ESTIMATE_WINDOW)))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.name), asc(t.agents.id), asc(recent.rn));
  }

  async estimateRows(workspaceId: string): Promise<EstimateRunRow[]> {
    const rows = await this.estimateRowsQuery(workspaceId);
    // postgres-js may return bigint/numeric as strings; keep null ≠ 0.
    return rows.map((r) => ({
      agentId: r.agentId,
      rn: r.rn == null ? null : Number(r.rn),
      durationMs: r.durationMs == null ? null : Number(r.durationMs),
      costUsd: toCostUsd(r.costUsd),
    }));
  }
}
