/* lib/smart-diff.ts — deterministic, client-side grouping of changed files by
   role for the "Smart order" view of Files changed. Pure: no React, no data
   fetching. The classification rules live in the shared module
   (vendor/shared/smart-diff-rules.ts), which the server's
   GET /pulls/:id/smart-diff uses too; this file only groups and re-exports. */
import { SMART_GROUP_ORDER, classifySmartFile, type SmartGroupKey } from "@devdigest/shared";

export { SMART_GROUP_ORDER, type SmartGroupKey };

/** Classify a changed file path into one smart group (boilerplate > tests > wiring > docs > core). */
export const classifyFile = classifySmartFile;

export interface SmartGroup<F> {
  key: SmartGroupKey;
  files: F[];
  /** Number of FILES in the group with at least one finding. */
  filesWithFindings: number;
}

/** Always returns all five groups in SMART_GROUP_ORDER; original file order kept inside each. */
export function buildSmartGroups<F extends { path: string }>(
  files: readonly F[],
  findings: readonly { file: string }[],
): SmartGroup<F>[] {
  const withFindings = new Set(findings.map((f) => f.file));
  const groups: SmartGroup<F>[] = SMART_GROUP_ORDER.map((key) => ({
    key,
    files: [],
    filesWithFindings: 0,
  }));
  for (const file of files) {
    const g = groups[SMART_GROUP_ORDER.indexOf(classifyFile(file.path))]!;
    g.files.push(file);
    if (withFindings.has(file.path)) g.filesWithFindings += 1;
  }
  return groups;
}

/** core/tests/wiring open by default; docs/boilerplate only when they hold findings. */
export function defaultGroupOpen(key: SmartGroupKey, filesWithFindings: number): boolean {
  if (key === "docs" || key === "boilerplate") return filesWithFindings > 0;
  return true;
}
