/** Pure helpers for Configure run (AC-MAR-20, 29, 30). */
import type { AgentEstimate, PrMeta } from "@devdigest/shared";
import { MAX_AGENTS_PER_RUN } from "@/lib/multi-agent";

/** An agent's estimate, or null when it has no usable history ("no estimate"). */
export function usableEstimate(e: AgentEstimate | undefined): AgentEstimate | null {
  if (!e || e.runs === 0) return null;
  if (e.avg_duration_ms == null && e.avg_cost_usd == null) return null;
  return e;
}

export interface EstimateTotals {
  /** max of the known durations — agents run in parallel (null = none known). */
  durationMs: number | null;
  /** sum of the known costs (null = none known). */
  costUsd: number | null;
  /** some selected agent has no estimate, or lacks its duration or cost. */
  partial: boolean;
}

/**
 * Total estimate of the selected agents (AC-MAR-20): wall clock = the slowest
 * known agent, cost = the sum of the known costs. Unknown values are left out
 * and flagged as `partial` — never guessed.
 */
export function estimateTotals(
  selectedIds: readonly string[],
  estimates: ReadonlyMap<string, AgentEstimate>
): EstimateTotals {
  let durationMs: number | null = null;
  let costUsd: number | null = null;
  let partial = false;
  for (const id of selectedIds) {
    const e = usableEstimate(estimates.get(id));
    if (!e) {
      partial = true;
      continue;
    }
    if (e.avg_duration_ms == null) partial = true;
    else durationMs = Math.max(durationMs ?? 0, e.avg_duration_ms);
    if (e.avg_cost_usd == null) partial = true;
    else costUsd = (costUsd ?? 0) + e.avg_cost_usd;
  }
  return { durationMs, costUsd, partial };
}

/** "8.2s" under a minute, "1m 05s" above; "—" when unknown. */
export function formatEstimateDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * "Select all": keep the current picks (and their order), then add the other
 * agents in list order, up to the per-run limit.
 */
export function selectAllAgents(
  selected: readonly string[],
  agents: readonly { id: string }[],
  max = MAX_AGENTS_PER_RUN
): string[] {
  const rest = agents.map((a) => a.id).filter((id) => !selected.includes(id));
  return [...selected, ...rest].slice(0, max);
}

/** The stored PRs of the repo that can be reviewed (they have an id). */
export function selectablePulls(pulls: readonly PrMeta[] | undefined): (PrMeta & { id: string })[] {
  return (pulls ?? []).filter((p): p is PrMeta & { id: string } => !!p.id);
}

/** The PR named by `?pr=`, if it is one of the repo's stored PRs (AC-MAR-30). */
export function pullFromQuery(
  pulls: readonly (PrMeta & { id: string })[],
  prParam: string | null
): (PrMeta & { id: string }) | null {
  if (!prParam) return null;
  return pulls.find((p) => p.id === prParam) ?? null;
}
