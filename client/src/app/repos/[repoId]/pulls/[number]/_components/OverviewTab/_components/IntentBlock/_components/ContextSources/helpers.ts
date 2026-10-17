import type { IntentContextSource } from "@devdigest/shared";

/** A context gap shown to the user (message key + optional count). */
export interface ContextGap {
  key: "descriptionMissing" | "noLinkedIssues" | "issuesUnavailable" | "unverified" | "noPlanDocs";
  count?: number;
}

/**
 * What the intent did NOT have, derived only from the recorded sources:
 * an empty description, no linked issue at all, issues that could not be
 * loaded, references that were never read, and no planning document.
 */
export function contextGaps(sources: readonly IntentContextSource[]): ContextGap[] {
  const gaps: ContextGap[] = [];
  if (sources.some((x) => x.kind === "pr_description" && x.status === "missing")) gaps.push({ key: "descriptionMissing" });
  const issues = sources.filter((x) => x.kind === "linked_issue");
  if (issues.length === 0) gaps.push({ key: "noLinkedIssues" });
  const unavailable = sources.filter((x) => x.status === "unavailable").length;
  if (unavailable > 0) gaps.push({ key: "issuesUnavailable", count: unavailable });
  const unverified = sources.filter((x) => x.status === "unverified").length;
  if (unverified > 0) gaps.push({ key: "unverified", count: unverified });
  if (!sources.some((x) => x.kind === "plan_doc" || x.kind === "plan_link")) gaps.push({ key: "noPlanDocs" });
  return gaps;
}

/** Sources worth listing: PR title/description are implied unless something is wrong with them. */
export function listedSources(sources: readonly IntentContextSource[]): IntentContextSource[] {
  return sources.filter((x) => !((x.kind === "pr_title" || x.kind === "pr_description") && x.status === "confirmed"));
}
