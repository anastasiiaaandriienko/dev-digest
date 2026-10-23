import type { EvalCaseRunResult, EvalFpReason, Finding } from "@devdigest/shared";

/* Pure helpers of the run detail drawer. Every case of an input group carries
   that group's FP list and dropped findings, so they are de-duplicated here for
   display — counts come from the stored run `counts`, never from these lists. */

export function findingLocation(f: Pick<Finding, "file" | "start_line" | "end_line">): string {
  return `${f.file}:${f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}`;
}

const key = (f: Finding) => JSON.stringify([f.file, f.start_line, f.end_line, f.id, f.title]);

/** The run's false positives, one row per finding (groups repeat them on every case). */
export function uniqueFalsePositives(results: readonly EvalCaseRunResult[]): { finding: Finding; reason: EvalFpReason }[] {
  const seen = new Map<string, { finding: Finding; reason: EvalFpReason }>();
  for (const r of results) for (const fp of r.group_fp) if (!seen.has(key(fp.finding))) seen.set(key(fp.finding), fp);
  return [...seen.values()];
}

/** How many distinct findings the citation gate dropped in this run. */
export function uniqueDroppedCount(results: readonly EvalCaseRunResult[]): number {
  return new Set(results.flatMap((r) => r.dropped.map((d) => key(d.finding)))).size;
}
