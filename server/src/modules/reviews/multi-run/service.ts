import type { Container } from '../../../platform/container.js';
import type { AgentColumnFinding, AgentEstimate, MultiAgentRun } from '@devdigest/shared';
import { NotFoundError } from '../../../platform/errors.js';
import type { FindingRow } from '../../../db/rows.js';
import { ReviewRepository } from '../repository.js';
import type { ReviewRow } from '../repository/review.repo.js';
import { findingRowToDto } from '../helpers.js';
import { ESTIMATE_WINDOW, MultiRunRepository, type EstimateRunRow } from './repository.js';
import { buildMultiAgentRun, type ChildRunInput } from './helpers.js';

/**
 * L07 multi-agent run reads (GET /pulls/:id/multi-agent). Read-only: loads
 * the PR's latest multi-run and its linked child runs, then the pure helpers
 * compute columns, groups, conflicts and totals on every read (nothing stored).
 */
export class MultiRunService {
  private repo: ReviewRepository;
  private multiRuns: MultiRunRepository;

  constructor(container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.multiRuns = new MultiRunRepository(container.db);
  }

  /** The PR's latest multi-run, `null` when it has none; 404 outside the workspace. */
  async read(workspaceId: string, prId: string): Promise<{ multi_run: MultiAgentRun | null }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const parent = await this.multiRuns.latestForPull(workspaceId, prId);
    if (!parent) return { multi_run: null };

    const children = await this.multiRuns.childrenOf(workspaceId, parent.id);
    const { reviews, findings } = await this.multiRuns.reviewsForRuns(
      workspaceId,
      children.map((c) => c.run.id),
    );
    const evalCaseIds = await this.multiRuns.evalCaseIdsForFindings(
      workspaceId,
      findings.map((f) => f.id),
    );

    // One review per run; reviews come newest first, so the first one wins.
    const reviewByRun = new Map<string, ReviewRow>();
    for (const review of reviews) {
      if (review.runId && !reviewByRun.has(review.runId)) reviewByRun.set(review.runId, review);
    }
    const findingsByReview = new Map<string, FindingRow[]>();
    for (const f of findings) {
      const list = findingsByReview.get(f.reviewId) ?? [];
      list.push(f);
      findingsByReview.set(f.reviewId, list);
    }

    const inputs: ChildRunInput[] = children.map(({ run, agentName, costUsd }) => {
      const review = reviewByRun.get(run.id) ?? null;
      const rows = review ? (findingsByReview.get(review.id) ?? []) : [];
      return {
        runId: run.id,
        agentId: run.agentId,
        agentName,
        provider: run.provider,
        model: run.model,
        status: run.status,
        error: run.error,
        score: run.score,
        durationMs: run.durationMs,
        ranAt: run.ranAt,
        costUsd,
        review: review ? { verdict: review.verdict, summary: review.summary, score: review.score } : null,
        findings: rows.map((row) => toColumnFinding(row, evalCaseIds.get(row.id) ?? null)),
      };
    });

    return {
      multi_run: buildMultiAgentRun(
        { id: parent.id, prId: parent.prId, prNumber: pull.number, ranAt: parent.ranAt },
        inputs,
      ),
    };
  }

  /** Time/cost estimate per workspace agent from its recent local runs (AC-MAR-19). */
  estimates(workspaceId: string): Promise<AgentEstimate[]> {
    return estimatesFor(this.multiRuns, workspaceId);
  }
}

/**
 * Per-agent estimates for the workspace (GET /multi-agent/estimates, AC-MAR-19).
 * Workspace-scoped; one query, then the averages are computed in memory.
 */
export async function estimatesFor(
  multiRuns: Pick<MultiRunRepository, 'estimateRows'>,
  workspaceId: string,
): Promise<AgentEstimate[]> {
  return aggregateEstimates(await multiRuns.estimateRows(workspaceId));
}

/**
 * Fold the estimate rows into one AgentEstimate per agent (first-seen order).
 * Window: only rows with `rn` 1..ESTIMATE_WINDOW count (the query already
 * limits this; re-checked here). `runs` = runs in the window;
 * `avg_duration_ms` = mean of the known durations (rounded to whole ms);
 * `avg_cost_usd` = mean of the known costs. A value nobody knows stays null —
 * an estimate is never invented.
 */
export function aggregateEstimates(rows: readonly EstimateRunRow[]): AgentEstimate[] {
  const byAgent = new Map<string, { runs: number; durations: number[]; costs: number[] }>();
  for (const row of rows) {
    const acc = byAgent.get(row.agentId) ?? { runs: 0, durations: [], costs: [] };
    byAgent.set(row.agentId, acc);
    if (row.rn == null || row.rn < 1 || row.rn > ESTIMATE_WINDOW) continue;
    acc.runs++;
    if (row.durationMs != null) acc.durations.push(row.durationMs);
    if (row.costUsd != null) acc.costs.push(row.costUsd);
  }
  const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  return [...byAgent].map(([agent_id, acc]) => {
    const avgDuration = mean(acc.durations);
    return {
      agent_id,
      runs: acc.runs,
      avg_duration_ms: avgDuration == null ? null : Math.round(avgDuration),
      avg_cost_usd: mean(acc.costs),
    };
  });
}

/** A persisted finding as an AgentColumnFinding (the FindingRecord fields it carries). */
function toColumnFinding(row: FindingRow, evalCaseId: string | null): AgentColumnFinding {
  const dto = findingRowToDto(row, evalCaseId);
  return {
    id: dto.id,
    severity: dto.severity,
    category: dto.category,
    title: dto.title,
    file: dto.file,
    start_line: dto.start_line,
    end_line: dto.end_line,
    kind: dto.kind,
    rationale: dto.rationale,
    suggestion: dto.suggestion,
    confidence: dto.confidence,
    review_id: dto.review_id,
    accepted_at: dto.accepted_at,
    dismissed_at: dto.dismissed_at,
    eval_case_id: dto.eval_case_id,
  };
}
