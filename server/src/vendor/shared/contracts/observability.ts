import { z } from 'zod';
import { Severity } from './findings.js';
import { ReviewRunResponse } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentStartResponse  POST /pulls/:id/review (ReviewRunResponse + multi_agent_run_id)
 *   - MultiAgentRun        GET /pulls/:id/multi-agent (latest multi-run of a PR)
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - FindingGroup         same-file, overlapping-range findings across agents
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentEstimate        GET /multi-agent/estimates (per-agent time/cost)
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/**
 * Response of POST /pulls/:id/review. `multi_agent_run_id` is the parent
 * multi-run for an `agentIds` request, and null for `agentId` / `all`.
 */
export const MultiAgentStartResponse = ReviewRunResponse.extend({
  multi_agent_run_id: z.string().nullable(),
});
export type MultiAgentStartResponse = z.infer<typeof MultiAgentStartResponse>;

/** A finding as surfaced in a multi-agent column (subset of FindingRecord). */
export const AgentColumnFinding = z.object({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  kind: z.string().nullish(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
  eval_case_id: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['done', 'failed', 'running', 'cancelled']),
  /** Failure reason when status is 'failed' or 'cancelled'. */
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AgentColumnFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string(),
  persona: z.string(),
  /**
   * Severity if the agent flagged it, 'ignored' when it finished without
   * flagging it ("did not flag"), or 'no_result' when its run failed, was
   * cancelled or is still running.
   */
  verdict: z.union([Severity, z.literal('ignored'), z.literal('no_result')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/** One finding inside a FindingGroup, with its original agent attribution. */
export const FindingGroupMember = z.object({
  finding_id: z.string(),
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
  severity: Severity,
  title: z.string(),
});
export type FindingGroupMember = z.infer<typeof FindingGroupMember>;

/**
 * Findings of different agents on the same file with overlapping line ranges
 * (transitive). Computed on read; findings are never copied or rewritten.
 * `takes` has one take per column, computed with the same rule as Conflict.
 */
export const FindingGroup = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  members: z.array(FindingGroupMember),
  takes: z.array(ConflictTake),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of GET /pulls/:id/multi-agent (the latest multi-run of a PR). */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  /** max(ran_at + duration) − min(ran_at) over terminal children; null if none. */
  wall_clock_ms: z.number().int().nullable(),
  total_cost_usd: z.number().nullable(),
  /** True when at least one column's cost is unknown. */
  cost_partial: z.boolean(),
  columns: z.array(AgentColumn),
  groups: z.array(FindingGroup),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** Per-agent estimate from its last `done` local runs (GET /multi-agent/estimates). */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  runs: z.number().int(),
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
