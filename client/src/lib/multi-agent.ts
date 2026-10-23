/* multi-agent.ts — pure helpers for the L07 Multi-Agent Review screens
   (specs/multi-agent-review.md). No React, no fetching. */
import type { AgentColumn } from "@devdigest/shared";

/** The Results page polls the multi-run this often while a column is running. */
export const MULTI_AGENT_POLL_MS = 4000;

/**
 * At most this many live SSE streams per Results page (A-T3): HTTP/1.1 allows
 * 6 connections per origin, so 8 streams would starve every other request.
 * The executor runs 4 agents at a time in list order, so the first ≤4
 * non-terminal columns are exactly the ones in flight.
 */
export const MAX_LIVE_STREAMS = 4;

/** A column that will not change any more (done, failed or cancelled). */
export function isTerminalStatus(status: AgentColumn["status"]): boolean {
  return status !== "running";
}

/** Run ids to stream live: the first `max` non-terminal columns, in column order. */
export function liveRunIds(
  columns: readonly Pick<AgentColumn, "run_id" | "status">[],
  max: number = MAX_LIVE_STREAMS
): string[] {
  return columns
    .filter((c) => !isTerminalStatus(c.status))
    .slice(0, Math.max(0, max))
    .map((c) => c.run_id);
}

/** Whether any column is still running (drives polling). */
export function hasRunningColumn(columns: readonly Pick<AgentColumn, "status">[] | undefined): boolean {
  return (columns ?? []).some((c) => !isTerminalStatus(c.status));
}

/**
 * Accent colours for agent cards and columns (A-T5): the Agent contract has no
 * colour, so one is picked from the theme palette by a stable hash of the id.
 */
export const AGENT_COLORS = ["var(--crit)", "var(--warn)", "var(--info)", "var(--accent)", "var(--ok)", "var(--sugg)"] as const;

export function agentColor(agentId: string): (typeof AGENT_COLORS)[number] {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length]!;
}
