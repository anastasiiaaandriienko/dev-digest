import { describe, it, expect } from "vitest";
import type { AgentColumnFinding } from "@devdigest/shared";
import { lineRange, parseView, toFindingRecord } from "./helpers";

/** L07 T10 — Results page pure helpers. */

describe("parseView", () => {
  it("defaults to columns; only 'tabs' switches", () => {
    expect(parseView(null)).toBe("columns");
    expect(parseView("columns")).toBe("columns");
    expect(parseView("tabs")).toBe("tabs");
    expect(parseView("weird")).toBe("columns");
  });
});

describe("toFindingRecord", () => {
  const f: AgentColumnFinding = {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "a.ts",
    start_line: 3,
    end_line: 5,
    kind: null,
    rationale: "r",
    suggestion: undefined,
    confidence: 0.7,
    review_id: "rev",
    accepted_at: null,
    dismissed_at: "2026-10-23T10:00:00.000Z",
    eval_case_id: undefined,
  };

  it("keeps the record fields and fills the shown-elsewhere extras with null", () => {
    expect(toFindingRecord(f)).toEqual({
      id: "f1",
      severity: "WARNING",
      category: "bug",
      title: "t",
      file: "a.ts",
      start_line: 3,
      end_line: 5,
      rationale: "r",
      suggestion: null,
      confidence: 0.7,
      kind: "finding",
      trifecta_components: null,
      evidence: null,
      review_id: "rev",
      accepted_at: null,
      dismissed_at: "2026-10-23T10:00:00.000Z",
      eval_case_id: null,
    });
  });

  it("lineRange renders single lines and ranges", () => {
    expect(lineRange({ start_line: 12, end_line: 12 })).toBe("12");
    expect(lineRange({ start_line: 12, end_line: 18 })).toBe("12–18");
  });
});
