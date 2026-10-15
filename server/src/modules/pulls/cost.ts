import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { toCostUsd, traceCostUsd } from '../../db/trace-cost.js';

/** A PR's L01 cost figure for the list (specs/review-run-cost.md §4.3). */
export interface PrCost {
  /** Sum over `done` runs with a known cost; null when no `done` run has one. */
  cost_usd: number | null;
  /** True when at least one `done` run has no known cost (`cost_usd` is a lower bound). */
  cost_partial: boolean;
}

/** No `done` runs → unknown, not partial. */
export const NO_COST: PrCost = { cost_usd: null, cost_partial: false };

/** Turn one aggregate row into the API shape. `SUM` skips nulls; `COUNT(expr)` too. */
export function toPrCost(row: { costUsd: unknown; doneRuns: number; pricedRuns: number }): PrCost {
  return {
    cost_usd: row.pricedRuns > 0 ? toCostUsd(row.costUsd) : null,
    cost_partial: row.pricedRuns < row.doneRuns,
  };
}

/**
 * Spend per PR over its SUCCESSFUL runs (every agent, every run in history).
 * Failed, cancelled, reaped and running runs are excluded. One grouped query
 * over all `prIds`, next to the list's latest-score query.
 */
export async function costByPullRequest(
  db: Db,
  workspaceId: string,
  prIds: string[],
): Promise<Map<string, PrCost>> {
  const out = new Map<string, PrCost>();
  if (prIds.length === 0) return out;
  const cost = traceCostUsd();
  const rows = await db
    .select({
      prId: t.agentRuns.prId,
      costUsd: sql<number | null>`sum(${cost})`,
      doneRuns: sql<number>`count(*)::int`,
      pricedRuns: sql<number>`count(${cost})::int`,
    })
    .from(t.agentRuns)
    .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        inArray(t.agentRuns.prId, prIds),
        eq(t.agentRuns.status, 'done'),
      ),
    )
    .groupBy(t.agentRuns.prId);
  for (const r of rows) {
    if (r.prId) out.set(r.prId, toPrCost(r));
  }
  return out;
}
