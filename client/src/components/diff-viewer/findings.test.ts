import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { anchorFindings } from "./findings";
import { parsePatch } from "./helpers";

function f(over: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

const ids = (xs: FindingRecord[] | undefined) => (xs ?? []).map((x) => x.id);

// idx: 0 hunk, 1 ctx(new1), 2 del(old2), 3 add(new2), 4 add(new3), 5 ctx(new4)
const LINES = parsePatch(["@@ -1,3 +1,4 @@", " a", "-b", "+B", "+C", " d"].join("\n"));

// idx: 0 hunk, 1 ctx(new1); old lines 2..4 are deleted
const DEL_LINES = parsePatch(["@@ -1,4 +1,1 @@", " a", "-b", "-c", "-d"].join("\n"));

describe("anchorFindings", () => {
  it("anchors to the line whose new number equals end_line (add and context)", () => {
    const r = anchorFindings(LINES, [
      f({ id: "x", start_line: 3, end_line: 3 }),
      f({ id: "y", start_line: 4, end_line: 4 }),
    ]);
    expect(ids(r.byLine.get(4))).toEqual(["x"]);
    expect(ids(r.byLine.get(5))).toEqual(["y"]);
    expect(r.unanchored).toEqual([]);
  });

  it("falls back to the rendered line closest to end_line within the range", () => {
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 2, end_line: 9 })]);
    expect(ids(r.byLine.get(5))).toEqual(["x"]); // new line 4 is nearest to 9
    expect(r.unanchored).toEqual([]);
  });

  it("leaves a range entirely outside the patch unanchored", () => {
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 50, end_line: 60 })]);
    expect(r.byLine.size).toBe(0);
    expect(ids(r.unanchored)).toEqual(["x"]);
  });

  it("never anchors to deleted lines (old-side-only numbers)", () => {
    const r = anchorFindings(DEL_LINES, [f({ id: "x", start_line: 3, end_line: 3 })]);
    expect(r.byLine.size).toBe(0);
    expect(ids(r.unanchored)).toEqual(["x"]);
  });

  it("does not dedup same-title findings from different reviews", () => {
    const r = anchorFindings(LINES, [
      f({ id: "a", review_id: "r1", title: "same", start_line: 3, end_line: 3 }),
      f({ id: "b", review_id: "r2", title: "same", start_line: 3, end_line: 3 }),
    ]);
    expect(ids(r.byLine.get(4))).toEqual(["a", "b"]);
  });

  it("orders by severity then id, per line and in unanchored", () => {
    const r = anchorFindings(LINES, [
      f({ id: "b", severity: "WARNING", start_line: 3, end_line: 3 }),
      f({ id: "z", severity: "CRITICAL", start_line: 3, end_line: 3 }),
      f({ id: "a", severity: "WARNING", start_line: 3, end_line: 3 }),
      f({ id: "s", severity: "SUGGESTION", start_line: 3, end_line: 3 }),
      f({ id: "u2", severity: "WARNING", start_line: 80, end_line: 80 }),
      f({ id: "u3", severity: "CRITICAL", start_line: 80, end_line: 80 }),
      f({ id: "u1", severity: "WARNING", start_line: 80, end_line: 80 }),
    ]);
    expect(ids(r.byLine.get(4))).toEqual(["z", "a", "b", "s"]);
    expect(ids(r.unanchored)).toEqual(["u3", "u1", "u2"]);
  });

  it("huge end_line (2147483647) finishes fast and anchors to the largest rendered newNo in range", () => {
    const t0 = performance.now();
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 2, end_line: 2147483647 })]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(ids(r.byLine.get(5))).toEqual(["x"]); // new line 4 is the largest in [2, max]
    expect(r.unanchored).toEqual([]);
  });

  it("huge range starting outside the patch is unanchored, quickly", () => {
    const t0 = performance.now();
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 100, end_line: 2147483647 })]);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(ids(r.unanchored)).toEqual(["x"]);
  });

  it("handles start_line > end_line by treating the range as swapped", () => {
    // end_line 0 is not rendered; swapped range is [0, 4] -> largest rendered newNo is 4 (idx 5)
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 4, end_line: 0 })]);
    expect(ids(r.byLine.get(5))).toEqual(["x"]);
    expect(r.unanchored).toEqual([]);
  });

  it("does not crash on NaN / Infinity / negative lines", () => {
    const r = anchorFindings(LINES, [
      f({ id: "nan", start_line: NaN, end_line: NaN }),
      f({ id: "inf", start_line: 1, end_line: Infinity }),
      f({ id: "ninf", start_line: -Infinity, end_line: 3 }),
      f({ id: "neg", start_line: -5, end_line: -1 }),
    ]);
    const anchored = [...r.byLine.values()].flat().map((x) => x.id);
    expect([...anchored, ...ids(r.unanchored)].sort()).toEqual(["inf", "nan", "neg", "ninf"]);
    // a finite end_line that is rendered still matches exactly, whatever start_line is
    expect(ids(r.byLine.get(4))).toEqual(["ninf"]);
    expect(ids(r.unanchored).sort()).toEqual(["inf", "nan", "neg"]);
  });

  it("an exact end_line match wins over the range fallback", () => {
    // end_line 3 is rendered (idx 4); a range up to 9 would otherwise pick new line 4 (idx 5)
    const r = anchorFindings(LINES, [f({ id: "x", start_line: 1, end_line: 3 })]);
    expect(ids(r.byLine.get(4))).toEqual(["x"]);
    expect(r.byLine.get(5)).toBeUndefined();
  });

  it("range fallback skips deleted lines", () => {
    const r = anchorFindings(DEL_LINES, [f({ id: "x", start_line: 1, end_line: 9 })]);
    expect(ids(r.byLine.get(1))).toEqual(["x"]); // only ctx new1 is rendered
  });

  it("returns everything unanchored for an empty lines array", () => {
    const r = anchorFindings(parsePatch(null), [f({ id: "x" }), f({ id: "y" })]);
    expect(r.byLine.size).toBe(0);
    expect(ids(r.unanchored)).toEqual(["x", "y"]);
  });

  it("does not mutate the input findings array", () => {
    const input = [f({ id: "b", severity: "SUGGESTION" }), f({ id: "a", severity: "CRITICAL" })];
    anchorFindings(LINES, input);
    expect(ids(input)).toEqual(["b", "a"]);
  });
});
