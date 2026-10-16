/* lib/findings.ts — shared, pure helpers over persisted findings (L01 severity
   counts, filters and the PR-list popover). No React, no data fetching. */
import type { FindingRecord, PrFindingsSummary, ReviewRecord } from "@devdigest/shared";

/** Severities the contract emits, in display order. */
export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
/** The UI tokens also know INFO; it is shown only when such findings exist. */
export type SeverityKey = (typeof SEVERITIES)[number] | "INFO";

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

export type SeverityCounts = Record<SeverityKey, number>;

/** Count findings per severity over ALL given findings (no other filter). */
export function countBySeverity(findings: readonly Pick<FindingRecord, "severity">[]): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 };
  for (const f of findings) {
    const key = f.severity as string;
    if (key in counts) counts[key as SeverityKey] += 1;
  }
  return counts;
}

/** Severities to render as chips: the three contract ones, plus INFO if present. */
export function severityKeys(counts: SeverityCounts): SeverityKey[] {
  return counts.INFO > 0 ? [...SEVERITIES, "INFO"] : [...SEVERITIES];
}

/** CRITICAL findings the user has not dismissed ("open criticals"). */
export function openCriticals(findings: readonly FindingRecord[]): number {
  return findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
}

/**
 * The most important findings first: undismissed before dismissed, then by
 * severity, then by confidence (highest first). Returns at most `limit`.
 */
export function topFindings(findings: readonly FindingRecord[], limit: number): FindingRecord[] {
  return [...findings]
    .sort(
      (a, b) =>
        Number(!!a.dismissed_at) - Number(!!b.dismissed_at) ||
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        b.confidence - a.confidence,
    )
    .slice(0, Math.max(0, limit));
}

/** "src/a.ts:11" or "src/a.ts:11-14". */
export function findingLocation(f: Pick<FindingRecord, "file" | "start_line" | "end_line">): string {
  return f.end_line !== f.start_line ? `${f.file}:${f.start_line}-${f.end_line}` : `${f.file}:${f.start_line}`;
}

/**
 * The reviews a PR-list findings summary counted (the latest completed review
 * of each agent, chosen by the server), in the summary's order. Reviews the
 * summary does not name (older runs of an agent, summaries) are left out, so
 * the popover's findings always match the FINDINGS column's counts.
 */
export function summaryReviews(
  reviews: readonly ReviewRecord[] | undefined,
  summary: PrFindingsSummary | null | undefined,
): ReviewRecord[] {
  if (!reviews || !summary) return [];
  const byId = new Map(reviews.map((r) => [r.id, r]));
  return summary.agents.flatMap((a) => byId.get(a.review_id) ?? []);
}

/**
 * Reviews whose findings are shown inline in the diff: the summary's reviews
 * (latest completed review of each agent) when the PR list computed a summary;
 * `null` summary = no completed review = none; `undefined` = not computed, so
 * fall back to every "review"-kind record.
 */
export function inlineReviews(
  reviews: readonly ReviewRecord[] | undefined,
  summary: PrFindingsSummary | null | undefined,
): ReviewRecord[] {
  if (!reviews) return [];
  if (summary === undefined) return reviews.filter((r) => r.kind === "review");
  return summaryReviews(reviews, summary);
}
