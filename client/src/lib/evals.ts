import type { AgentEvalCase, AgentEvalRun, EvalCaseOutcome } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/* evals.ts — pure helpers of the L06 eval UI (AgentEditor → Evals, Eval Dashboard;
   spec §12). A null metric is
   "undefined" (zero denominator / run not finished): it is rendered as "N/A",
   never as 0 % or 100 %, and it has no delta. */

/** Whole percent, or null when the metric is undefined. */
export function pct(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v * 100);
}

/** "82%" or the N/A label. */
export function fmtPct(v: number | null | undefined, na: string): string {
  const p = pct(v);
  return p == null ? na : `${p}%`;
}

/** Percentage-point delta (head − base, rounded); null when either side is undefined. */
export function deltaPt(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null) return null;
  return Math.round(cur * 100) - Math.round(prev * 100);
}

/** "$0.0021" below a cent, "$0.23" otherwise; N/A when the cost is unknown. */
export function fmtCost(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}

/** Runs come newest first; the latest and previous FINISHED (`done`) runs carry the metrics. */
export function latestDoneRuns(runs: readonly AgentEvalRun[]): { latest: AgentEvalRun | null; previous: AgentEvalRun | null } {
  const done = runs.filter((r) => r.status === "done");
  return { latest: done[0] ?? null, previous: done[1] ?? null };
}

export const isRunning = (runs: readonly AgentEvalRun[] | undefined): boolean => !!runs?.some((r) => r.status === "running");

/** Distinct frozen inputs = engine calls of one run (shown in the paid-call confirmation). */
export function distinctInputs(cases: readonly AgentEvalCase[]): number {
  return new Set(cases.map((c) => c.input_hash)).size;
}

/** Cases whose latest result passed, of those that have a result. */
export function passingCounts(cases: readonly AgentEvalCase[]): { passed: number; ran: number } {
  const ran = cases.filter((c) => c.last_result);
  const passed = ran.filter((c) => c.last_result!.outcome === "tp" || c.last_result!.outcome === "pass");
  return { passed: passed.length, ran: ran.length };
}

export type CaseStatus = "pass" | "fail" | "never";

export function caseStatus(outcome: EvalCaseOutcome | null | undefined): CaseStatus {
  if (!outcome) return "never";
  return outcome === "tp" || outcome === "pass" ? "pass" : "fail";
}

/** `file:11` / `file:11-15` of the frozen expectation. */
export function expectedLocation(c: Pick<AgentEvalCase, "expected">): string {
  const { file, start_line, end_line } = c.expected;
  return `${file}:${start_line === end_line ? start_line : `${start_line}-${end_line}`}`;
}

/** i18n key (under `evalsTab.startErrors`) for a failed start. */
export function startErrorKey(err: unknown): "eval_run_in_progress" | "no_eval_cases" | "too_many_cases" | "config_error" | "generic" {
  const code = err instanceof ApiError ? err.code : undefined;
  return code === "eval_run_in_progress" || code === "no_eval_cases" || code === "too_many_cases" || code === "config_error"
    ? code
    : "generic";
}

// ---- Eval Dashboard (spec §12.3-§12.4) -------------------------------------------

export type EvalMetricKey = "recall" | "precision" | "citation_accuracy";

/** One metric's values over the finished runs, oldest → newest, skipping undefined values. */
export function metricTrend(runs: readonly AgentEvalRun[], key: EvalMetricKey): number[] {
  return runs
    .filter((r) => r.status === "done" && r[key] != null)
    .map((r) => r[key] as number)
    .reverse();
}

/**
 * The finished runs the three-line trend chart can plot, oldest → newest: only
 * runs where all three metrics are defined (the chart would draw a null as 0).
 * `skipped` = finished runs left out because a metric is N/A.
 */
export function trendRuns(runs: readonly AgentEvalRun[]): { runs: AgentEvalRun[]; skipped: number } {
  const done = runs.filter((r) => r.status === "done");
  const complete = done.filter((r) => r.recall != null && r.precision != null && r.citation_accuracy != null);
  return { runs: [...complete].reverse(), skipped: done.length - complete.length };
}

/** Pick up to two runs; a third pick replaces the oldest pick (design `toggleRun`). */
export function toggleRunSelection(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length < 2) return [...selected, id];
  return [selected[1]!, id];
}

/** The two selected runs as [base, head] = [older, newer] by start time. */
export function orderForCompare(a: AgentEvalRun, b: AgentEvalRun): [AgentEvalRun, AgentEvalRun] {
  return a.started_at <= b.started_at ? [a, b] : [b, a];
}

/** "▲ 4pt" / "▼ 2pt" / "±0pt"; null when the delta is undefined. */
export function fmtDeltaPt(delta: number | null | undefined): string | null {
  if (delta == null) return null;
  const pt = Math.round(delta * 100);
  if (pt === 0) return "±0pt";
  return `${pt > 0 ? "▲" : "▼"} ${Math.abs(pt)}pt`;
}
