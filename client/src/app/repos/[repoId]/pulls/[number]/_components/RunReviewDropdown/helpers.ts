/** Pure selection logic of the multi-agent picker (AC-MAR-21..23). */
import type { Agent } from "@devdigest/shared";
import { MAX_AGENTS_PER_RUN } from "../../../../../../../lib/multi-agent";

/** Initial selection: enabled agents in list order, capped at `max` (AC-MAR-21). */
export function initialSelection(agents: readonly Pick<Agent, "id" | "enabled">[], max = MAX_AGENTS_PER_RUN): string[] {
  return agents.filter((a) => a.enabled).slice(0, max).map((a) => a.id);
}

/**
 * Toggle one agent. Checking appends (selection order = column order); a check
 * past `max` is ignored, so the selection never exceeds the server limit.
 */
export function toggleSelection(selected: readonly string[], id: string, max = MAX_AGENTS_PER_RUN): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= max) return [...selected];
  return [...selected, id];
}

/** Drop ids of agents that no longer exist (e.g. deleted while the picker was closed). */
export function pruneSelection(selected: readonly string[], agents: readonly Pick<Agent, "id">[]): string[] {
  const known = new Set(agents.map((a) => a.id));
  return selected.filter((id) => known.has(id));
}

export function isAtLimit(selected: readonly string[], max = MAX_AGENTS_PER_RUN): boolean {
  return selected.length >= max;
}
