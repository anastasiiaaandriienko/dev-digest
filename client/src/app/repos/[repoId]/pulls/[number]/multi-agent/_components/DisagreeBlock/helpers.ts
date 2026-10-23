/** Pure row selection for "Where agents disagree" (AC-MAR-42..44). Nothing is
   recomputed here: rows and their takes come from the server's `conflicts` and
   `groups`; the client only picks which ones to list. */
import type { AgentColumn, ConflictTake, MultiAgentRun } from "@devdigest/shared";

export interface DisagreeRow {
  key: string;
  file: string;
  start_line: number;
  end_line: number;
  title: string;
  /** One server-side take per column. */
  takes: ConflictTake[];
  conflict: boolean;
}

const rowKey = (r: { file: string; start_line: number; end_line: number }) => `${r.file}:${r.start_line}:${r.end_line}`;

/**
 * Toggle ON (default): conflicts only. OFF: every group flagged by ≥2 agents
 * plus every conflict, de-duplicated by file + line range, by file then line.
 */
export function disagreeRows(
  run: Pick<MultiAgentRun, "groups" | "conflicts">,
  onlyConflicts: boolean
): DisagreeRow[] {
  const rows = new Map<string, DisagreeRow>();
  for (const c of run.conflicts) {
    rows.set(rowKey(c), { key: rowKey(c), file: c.file, start_line: c.start_line, end_line: c.end_line, title: c.title, takes: c.takes, conflict: true });
  }
  if (!onlyConflicts) {
    for (const g of run.groups) {
      const key = rowKey(g);
      if (rows.has(key)) continue;
      // "Flagged by ≥2 agents" — distinct columns among the group's members.
      if (new Set(g.members.map((m) => m.run_id)).size < 2) continue;
      rows.set(key, { key, file: g.file, start_line: g.start_line, end_line: g.end_line, title: g.title, takes: g.takes, conflict: false });
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.start_line - b.start_line
  );
}

/** Some agent is still running, so the block covers finished agents only (AC-MAR-44). */
export function isPartial(columns: readonly Pick<AgentColumn, "status">[]): boolean {
  return columns.some((c) => c.status === "running");
}

/** "file.ts:28" or "file.ts:28–34". */
export function locationLabel(r: Pick<DisagreeRow, "file" | "start_line" | "end_line">): string {
  return r.end_line > r.start_line ? `${r.file}:${r.start_line}–${r.end_line}` : `${r.file}:${r.start_line}`;
}

export type TakeKind = "severity" | "ignored" | "no_result";

/** ignored = the agent finished without flagging it; no_result = it has no finished result yet. */
export function takeKind(take: Pick<ConflictTake, "verdict">): TakeKind {
  if (take.verdict === "ignored") return "ignored";
  if (take.verdict === "no_result") return "no_result";
  return "severity";
}
