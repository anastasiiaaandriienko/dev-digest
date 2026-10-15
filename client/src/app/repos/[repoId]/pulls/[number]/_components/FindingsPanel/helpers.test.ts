import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { toggleSeverity, visibleFindings } from "./helpers";

function f(id: string, severity: FindingRecord["severity"], confidence = 0.9): FindingRecord {
  return {
    id,
    severity,
    category: "bug",
    title: id,
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r",
    accepted_at: null,
    dismissed_at: null,
  };
}

const LIST = [f("w", "WARNING"), f("c-low", "CRITICAL", 0.3), f("c", "CRITICAL"), f("s", "SUGGESTION")];
const ids = (xs: FindingRecord[]) => xs.map((x) => x.id);

describe("visibleFindings (S1)", () => {
  it("no filters: everything, sorted by severity", () => {
    expect(ids(visibleFindings(LIST, { hideLow: false }))).toEqual(["c-low", "c", "w", "s"]);
    expect(ids(visibleFindings(LIST, { hideLow: false, severities: new Set() }))).toHaveLength(4);
  });

  it("{CRITICAL} keeps only criticals; with hideLow also drops low confidence (AND)", () => {
    const sev = new Set(["CRITICAL"]);
    expect(ids(visibleFindings(LIST, { hideLow: false, severities: sev }))).toEqual(["c-low", "c"]);
    expect(ids(visibleFindings(LIST, { hideLow: true, severities: sev }))).toEqual(["c"]);
  });

  it("multi-select keeps the union of the selected severities", () => {
    expect(ids(visibleFindings(LIST, { hideLow: false, severities: new Set(["WARNING", "SUGGESTION"]) }))).toEqual([
      "w",
      "s",
    ]);
  });

  it("does not mutate its input", () => {
    const copy = [...LIST];
    visibleFindings(LIST, { hideLow: true, severities: new Set(["WARNING"]) });
    expect(LIST).toEqual(copy);
  });
});

describe("toggleSeverity", () => {
  it("adds and removes immutably", () => {
    const a = new Set<string>();
    const b = toggleSeverity(a, "CRITICAL");
    expect([...b]).toEqual(["CRITICAL"]);
    expect(a.size).toBe(0);
    expect([...toggleSeverity(b, "CRITICAL")]).toEqual([]);
  });
});
