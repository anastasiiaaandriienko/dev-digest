import { describe, it, expect } from "vitest";
import type { EvalCaseRunResult, Finding } from "@devdigest/shared";
import { findingLocation, uniqueDroppedCount, uniqueFalsePositives } from "./helpers";

const f = (id: string, line: number): Finding => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: id,
  file: "src/a.ts",
  start_line: line,
  end_line: line,
  rationale: "r",
  confidence: 1,
});
const result = (caseId: string, fps: Finding[], dropped: Finding[]): EvalCaseRunResult =>
  ({
    case_id: caseId,
    group_fp: fps.map((finding) => ({ finding, reason: "unlabeled" })),
    dropped: dropped.map((finding) => ({ finding, reason: "x" })),
  }) as unknown as EvalCaseRunResult;

describe("run detail helpers", () => {
  it("de-duplicates the group FP list repeated on every case of the group", () => {
    const shared = [f("x", 3), f("y", 9)];
    const fps = uniqueFalsePositives([result("c1", shared, []), result("c2", shared, []), result("c3", [f("z", 1)], [])]);
    expect(fps.map((p) => p.finding.id)).toEqual(["x", "y", "z"]);
  });

  it("counts distinct dropped findings", () => {
    const d = [f("d1", 400)];
    expect(uniqueDroppedCount([result("c1", [], d), result("c2", [], d), result("c3", [], [f("d2", 500)])])).toBe(2);
  });

  it("formats a finding location", () => {
    expect(findingLocation({ file: "a.ts", start_line: 2, end_line: 2 })).toBe("a.ts:2");
    expect(findingLocation({ file: "a.ts", start_line: 2, end_line: 4 })).toBe("a.ts:2-4");
  });
});
