import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFindingsSummary, ReviewRecord } from "@devdigest/shared";
import {
  countBySeverity,
  findingLocation,
  inlineReviews,
  openCriticals,
  severityKeys,
  summaryReviews,
  topFindings,
} from "./findings";

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

describe("summaryReviews", () => {
  const rev = (id: string, agentId: string): ReviewRecord => ({
    id,
    pr_id: "pr",
    agent_id: agentId,
    run_id: null,
    agent_name: agentId,
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-10-11T10:00:00.000Z",
    findings: [f(`${id}-f`, "WARNING", { review_id: id })],
  });
  const summary = (ids: string[]): PrFindingsSummary => ({
    total: ids.length,
    counts: { CRITICAL: 0, WARNING: ids.length, SUGGESTION: 0, INFO: 0 },
    agents: ids.map((id) => ({
      agent_id: null,
      agent_name: null,
      review_id: id,
      verdict: null,
      created_at: "2026-10-11T10:00:00.000Z",
      total: 1,
      counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0, INFO: 0 },
    })),
  });

  it("keeps only the reviews the summary selected, in the summary order", () => {
    const reviews = [rev("a1-new", "a1"), rev("a2", "a2"), rev("a1-old", "a1")];
    expect(summaryReviews(reviews, summary(["a2", "a1-new"])).map((r) => r.id)).toEqual(["a2", "a1-new"]);
  });

  it("skips summary entries that were not returned, and handles missing input", () => {
    expect(summaryReviews([rev("a", "a1")], summary(["a", "gone"])).map((r) => r.id)).toEqual(["a"]);
    expect(summaryReviews(undefined, summary(["a"]))).toEqual([]);
    expect(summaryReviews([rev("a", "a1")], null)).toEqual([]);
  });
});

describe("inlineReviews", () => {
  const rev = (id: string, agentId: string, kind: ReviewRecord["kind"] = "review"): ReviewRecord => ({
    id,
    pr_id: "pr",
    agent_id: agentId,
    run_id: null,
    agent_name: agentId,
    kind,
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-10-11T10:00:00.000Z",
    findings: [],
  });
  const summary = (ids: string[]): PrFindingsSummary => ({
    total: ids.length,
    counts: { CRITICAL: 0, WARNING: ids.length, SUGGESTION: 0, INFO: 0 },
    agents: ids.map((id) => ({
      agent_id: null,
      agent_name: null,
      review_id: id,
      verdict: null,
      created_at: "2026-10-11T10:00:00.000Z",
      total: 1,
      counts: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0, INFO: 0 },
    })),
  });

  it("returns [] without reviews", () => {
    expect(inlineReviews(undefined, undefined)).toEqual([]);
    expect(inlineReviews(undefined, summary(["a"]))).toEqual([]);
  });

  it("summary not computed (undefined): every review-kind record, summaries excluded", () => {
    const reviews = [rev("a", "a1"), rev("s", "a1", "summary"), rev("b", "a2")];
    expect(inlineReviews(reviews, undefined).map((r) => r.id)).toEqual(["a", "b"]);
    expect(inlineReviews(reviews, undefined).every((r) => r.kind === "review")).toBe(true);
  });

  it("null summary (no completed review): nothing", () => {
    expect(inlineReviews([rev("a", "a1")], null)).toEqual([]);
  });

  it("summary: latest completed review per agent only; two agents both included", () => {
    const reviews = [rev("a1-new", "a1"), rev("a1-old", "a1"), rev("a2", "a2")];
    const ids = inlineReviews(reviews, summary(["a1-new", "a2"])).map((r) => r.id);
    expect(ids).toEqual(["a1-new", "a2"]);
    expect(ids).not.toContain("a1-old");
  });
});
