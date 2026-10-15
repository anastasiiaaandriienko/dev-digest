import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { countBySeverity, findingLocation, openCriticals, severityKeys, topFindings } from "./findings";

function f(id: string, severity: string, o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: severity as FindingRecord["severity"],
    category: "bug",
    title: id,
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

describe("countBySeverity", () => {
  it("counts each severity, zero for absent ones", () => {
    expect(countBySeverity([f("a", "CRITICAL"), f("b", "CRITICAL"), f("c", "SUGGESTION")])).toEqual({
      CRITICAL: 2,
      WARNING: 0,
      SUGGESTION: 1,
      INFO: 0,
    });
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 });
  });

  it("ignores unknown severities instead of crashing", () => {
    expect(countBySeverity([f("x", "BOGUS")])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 });
  });
});

describe("severityKeys", () => {
  it("lists INFO only when there are INFO findings", () => {
    expect(severityKeys(countBySeverity([]))).toEqual(["CRITICAL", "WARNING", "SUGGESTION"]);
    expect(severityKeys(countBySeverity([f("i", "INFO")]))).toEqual(["CRITICAL", "WARNING", "SUGGESTION", "INFO"]);
  });
});

describe("openCriticals", () => {
  it("counts undismissed CRITICAL findings only", () => {
    expect(
      openCriticals([f("a", "CRITICAL"), f("b", "CRITICAL", { dismissed_at: "t" }), f("c", "WARNING")]),
    ).toBe(1);
  });
});

describe("topFindings", () => {
  it("orders undismissed first, then severity, then confidence; respects the limit", () => {
    const list = [
      f("sug", "SUGGESTION"),
      f("crit-low", "CRITICAL", { confidence: 0.5 }),
      f("crit-dismissed", "CRITICAL", { confidence: 0.99, dismissed_at: "t" }),
      f("crit-high", "CRITICAL", { confidence: 0.9 }),
      f("warn", "WARNING"),
    ];
    expect(topFindings(list, 3).map((x) => x.id)).toEqual(["crit-high", "crit-low", "warn"]);
    expect(topFindings(list, 10).at(-1)!.id).toBe("crit-dismissed");
    expect(topFindings(list, 0)).toEqual([]);
  });
});

describe("findingLocation", () => {
  it("formats a single line or a range", () => {
    expect(findingLocation({ file: "a.ts", start_line: 3, end_line: 3 })).toBe("a.ts:3");
    expect(findingLocation({ file: "a.ts", start_line: 3, end_line: 9 })).toBe("a.ts:3-9");
  });
});
