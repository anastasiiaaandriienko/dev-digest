/** Pure helpers for the multi-agent Results page (AC-MAR-32, 37). */
import type { AgentColumnFinding, FindingRecord } from "@devdigest/shared";

export type ResultsViewMode = "columns" | "tabs";

/** `?view` → mode; anything unknown falls back to the default `columns` (spec §5). */
export function parseView(raw: string | null | undefined): ResultsViewMode {
  return raw === "tabs" ? "tabs" : "columns";
}

/**
 * A column finding as the FindingRecord the shared FindingCard renders. The
 * multi-run read carries every FindingRecord field except the trifecta and
 * evidence extras, which a multi-agent column does not show.
 */
export function toFindingRecord(f: AgentColumnFinding): FindingRecord {
  return {
    id: f.id,
    severity: f.severity,
    category: f.category as FindingRecord["category"],
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: f.rationale,
    suggestion: f.suggestion ?? null,
    confidence: f.confidence,
    kind: (f.kind ?? "finding") as FindingRecord["kind"],
    trifecta_components: null,
    evidence: null,
    review_id: f.review_id,
    accepted_at: f.accepted_at,
    dismissed_at: f.dismissed_at,
    eval_case_id: f.eval_case_id ?? null,
  };
}

/** "L12" or "L12–18" for a column finding. */
export function lineRange(f: Pick<AgentColumnFinding, "start_line" | "end_line">): string {
  return f.end_line > f.start_line ? `${f.start_line}–${f.end_line}` : String(f.start_line);
}
