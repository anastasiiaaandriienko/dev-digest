import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PrFindingsAgent, PrFindingsSummary, PrSeverityCounts } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L01 PR-list FINDINGS across agents. For each PR, take the latest COMPLETED
 * review of EACH agent and count only those reviews' findings, so re-running
 * an agent replaces its earlier result instead of adding to it.
 *
 * "Completed": a `kind = 'review'` row whose run is `done`. A review without a
 * run (seeded / pre-run-tracking) or whose run row is gone has nothing that
 * says otherwise, so it counts. Reviews with no agent share one bucket.
 */

/** One candidate review row (any order). */
export interface CandidateReview {
  id: string;
  prId: string;
  agentId: string | null;
  agentName: string | null;
  verdict: string | null;
  createdAt: Date;
}

/** Findings of one review per severity. */
export interface SeverityRow {
  reviewId: string;
  severity: string;
  count: number;
}

const VERDICTS = new Set(['request_changes', 'approve', 'comment']);

export function emptyCounts(): PrSeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 };
}

/**
 * The latest review per (PR, agent), newest first within each PR. Ties on
 * `createdAt` are broken by id so the choice is deterministic.
 */
export function latestReviewPerAgent(rows: readonly CandidateReview[]): Map<string, CandidateReview[]> {
  const sorted = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const seen = new Set<string>();
  const out = new Map<string, CandidateReview[]>();
  for (const r of sorted) {
    const key = `${r.prId}\u0000${r.agentId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(r.prId) ?? [];
    list.push(r);
    out.set(r.prId, list);
  }
  return out;
}

/** Build each PR's summary from its selected reviews and their severity counts. */
export function buildFindingsSummaries(
  selected: ReadonlyMap<string, readonly CandidateReview[]>,
  severityRows: readonly SeverityRow[],
): Map<string, PrFindingsSummary> {
  const perReview = new Map<string, { total: number; counts: PrSeverityCounts }>();
  for (const row of severityRows) {
    const entry = perReview.get(row.reviewId) ?? { total: 0, counts: emptyCounts() };
    entry.total += row.count;
    if (row.severity in entry.counts) entry.counts[row.severity as keyof PrSeverityCounts] += row.count;
    perReview.set(row.reviewId, entry);
  }

  const out = new Map<string, PrFindingsSummary>();
  for (const [prId, reviews] of selected) {
    const counts = emptyCounts();
    let total = 0;
    const agents: PrFindingsAgent[] = reviews.map((r) => {
      const own = perReview.get(r.id) ?? { total: 0, counts: emptyCounts() };
      total += own.total;
      for (const k of Object.keys(counts) as (keyof PrSeverityCounts)[]) counts[k] += own.counts[k];
      return {
        agent_id: r.agentId,
        agent_name: r.agentName,
        review_id: r.id,
        verdict: r.verdict && VERDICTS.has(r.verdict) ? (r.verdict as PrFindingsAgent['verdict']) : null,
        created_at: r.createdAt.toISOString(),
        total: own.total,
        counts: { ...own.counts },
      };
    });
    out.set(prId, { total, counts, agents });
  }
  return out;
}

/**
 * Findings summary per PR (absent = no completed review). Two queries: the
 * candidate reviews, then severity counts for the selected reviews only.
 */
export async function findingsSummaryByPullRequest(
  db: Db,
  workspaceId: string,
  prIds: string[],
): Promise<Map<string, PrFindingsSummary>> {
  if (prIds.length === 0) return new Map();
  const candidates = await db
    .select({
      id: t.reviews.id,
      prId: t.reviews.prId,
      agentId: t.reviews.agentId,
      agentName: t.agents.name,
      verdict: t.reviews.verdict,
      createdAt: t.reviews.createdAt,
    })
    .from(t.reviews)
    .leftJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
    .leftJoin(t.agents, and(eq(t.agents.id, t.reviews.agentId), eq(t.agents.workspaceId, workspaceId)))
    .where(
      and(
        eq(t.reviews.workspaceId, workspaceId),
        inArray(t.reviews.prId, prIds),
        eq(t.reviews.kind, 'review'),
        or(isNull(t.agentRuns.id), eq(t.agentRuns.status, 'done')),
      ),
    )
    .orderBy(desc(t.reviews.createdAt));

  const selected = latestReviewPerAgent(candidates);
  const reviewIds = [...selected.values()].flat().map((r) => r.id);
  const severityRows =
    reviewIds.length === 0
      ? []
      : await db
          .select({
            reviewId: t.findings.reviewId,
            severity: t.findings.severity,
            count: sql<number>`count(*)::int`,
          })
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
          .groupBy(t.findings.reviewId, t.findings.severity);
  return buildFindingsSummaries(selected, severityRows);
}
