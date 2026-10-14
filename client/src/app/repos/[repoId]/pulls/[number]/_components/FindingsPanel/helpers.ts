import type { FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

export interface FindingsFilter {
  /** Drop findings with confidence below LOW_CONFIDENCE_THRESHOLD. */
  hideLow: boolean;
  /** Severities to keep; empty = all severities. */
  severities?: ReadonlySet<string>;
}

/** Apply the panel filters (AND-combined) and sort by severity. */
export function visibleFindings(findings: FindingRecord[], filter: FindingsFilter): FindingRecord[] {
  let shown = findings;
  if (filter.hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  const sev = filter.severities;
  if (sev && sev.size > 0) shown = shown.filter((f) => sev.has(f.severity));
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** Toggle one severity in a multi-select set (immutably). */
export function toggleSeverity(selected: ReadonlySet<string>, severity: string): Set<string> {
  const next = new Set(selected);
  if (next.has(severity)) next.delete(severity);
  else next.add(severity);
  return next;
}
