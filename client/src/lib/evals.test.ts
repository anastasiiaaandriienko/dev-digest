import { describe, it, expect } from "vitest";
import type { AgentEvalCase, AgentEvalRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  caseStatus,
  deltaPt,
  distinctInputs,
  expectedLocation,
  fmtCost,
  fmtDeltaPt,
  fmtPct,
  isRunning,
  latestDoneRuns,
  metricTrend,
  orderForCompare,
  passingCounts,
  pct,
  startErrorKey,
  toggleRunSelection,
  trendRuns,
} from "./evals";

const run = (id: string, status: AgentEvalRun["status"], over: Partial<AgentEvalRun> = {}): AgentEvalRun => ({
  id,
  agent_id: "a",
  agent_version: 1,
  prompt_sha: "p",
  status,
  error: null,
  started_at: "2026-10-22T10:00:00.000Z",
  finished_at: null,
  recall: null,
  precision: null,
  citation_accuracy: null,
  counts: null,
  cost_usd: null,
  duration_ms: null,
  ...over,
});
const kase = (id: string, hash: string, outcome?: "tp" | "fn" | "pass" | "fail" | "error"): AgentEvalCase =>
  ({
    id,
    input_hash: hash,
    expected: { file: "src/a.ts", start_line: 3, end_line: 3 },
    last_result: outcome ? { suite_run_id: "r", outcome, ran_at: "t" } : null,
  }) as AgentEvalCase;

describe("metric formatting (null = N/A, never 0 / 100 %)", () => {
  it("formats percentages and keeps undefined metrics as N/A", () => {
    expect(fmtPct(0.825, "N/A")).toBe("83%");
    expect(fmtPct(0, "N/A")).toBe("0%");
    expect(fmtPct(1, "N/A")).toBe("100%");
    expect(fmtPct(null, "N/A")).toBe("N/A");
    expect(fmtPct(undefined, "N/A")).toBe("N/A");
    expect(pct(null)).toBeNull();
  });

  it("has no delta when either side is undefined", () => {
    expect(deltaPt(0.82, 0.78)).toBe(4);
    expect(deltaPt(0.5, 0.75)).toBe(-25);
    expect(deltaPt(null, 0.5)).toBeNull();
    expect(deltaPt(0.5, null)).toBeNull();
    expect(deltaPt(0.5, undefined)).toBeNull();
  });

  it("formats cost with enough precision and N/A when unknown", () => {
    expect(fmtCost(0.0021, "N/A")).toBe("$0.0021");
    expect(fmtCost(0.23, "N/A")).toBe("$0.23");
    expect(fmtCost(0, "N/A")).toBe("$0.0000");
    expect(fmtCost(null, "N/A")).toBe("N/A");
  });
});

describe("run selection", () => {
  it("takes metrics from the two latest DONE runs, skipping running and failed ones", () => {
    const runs = [run("r4", "running"), run("r3", "failed"), run("r2", "done"), run("r1", "done"), run("r0", "done")];
    const { latest, previous } = latestDoneRuns(runs);
    expect([latest?.id, previous?.id]).toEqual(["r2", "r1"]);
    expect(isRunning(runs)).toBe(true);
    expect(latestDoneRuns([run("x", "failed")])).toEqual({ latest: null, previous: null });
  });
});

describe("cases", () => {
  it("counts distinct inputs, passing cases and case status", () => {
    const cases = [kase("a", "h1", "tp"), kase("b", "h1", "fail"), kase("c", "h2", "pass"), kase("d", "h3")];
    expect(distinctInputs(cases)).toBe(3);
    expect(passingCounts(cases)).toEqual({ passed: 2, ran: 3 });
    expect(caseStatus("tp")).toBe("pass");
    expect(caseStatus("error")).toBe("fail");
    expect(caseStatus(undefined)).toBe("never");
  });

  it("formats the expected location", () => {
    expect(expectedLocation(kase("a", "h"))).toBe("src/a.ts:3");
    expect(expectedLocation({ expected: { file: "x.ts", start_line: 2, end_line: 5 } } as AgentEvalCase)).toBe("x.ts:2-5");
  });

  it("maps start errors", () => {
    expect(startErrorKey(new ApiError("x", 409, "eval_run_in_progress"))).toBe("eval_run_in_progress");
    expect(startErrorKey(new ApiError("x", 500, "config_error"))).toBe("config_error");
    expect(startErrorKey(new ApiError("x", 500, "internal_error"))).toBe("generic");
    expect(startErrorKey(new Error("x"))).toBe("generic");
  });
});

describe("Eval Dashboard helpers", () => {
  const runs = [
    run("r4", "running"),
    run("r3", "done", { recall: 1, precision: null, citation_accuracy: 0.9, started_at: "2026-10-22T13:00:00.000Z" }),
    run("r2", "done", { recall: 0.5, precision: 0.5, citation_accuracy: 0.8, started_at: "2026-10-22T12:00:00.000Z" }),
    run("r1", "failed"),
    run("r0", "done", { recall: 0.25, precision: 0.4, citation_accuracy: 0.7, started_at: "2026-10-22T11:00:00.000Z" }),
  ];

  it("metricTrend: finished runs only, oldest first, N/A values skipped (never plotted as 0)", () => {
    expect(metricTrend(runs, "recall")).toEqual([0.25, 0.5, 1]);
    expect(metricTrend(runs, "precision")).toEqual([0.4, 0.5]);
  });

  it("trendRuns: only finished runs with all three metrics, and how many were left out", () => {
    const t = trendRuns(runs);
    expect(t.runs.map((r) => r.id)).toEqual(["r0", "r2"]);
    expect(t.skipped).toBe(1);
  });

  it("toggleRunSelection: up to two, a third pick replaces the oldest pick, re-click unselects", () => {
    expect(toggleRunSelection([], "a")).toEqual(["a"]);
    expect(toggleRunSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleRunSelection(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(toggleRunSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("orderForCompare: older run is the base", () => {
    const [base, head] = orderForCompare(runs[1]!, runs[4]!);
    expect([base.id, head.id]).toEqual(["r0", "r3"]);
  });

  it("fmtDeltaPt: rounded points, null stays null", () => {
    expect(fmtDeltaPt(0.04)).toBe("▲ 4pt");
    expect(fmtDeltaPt(-0.166)).toBe("▼ 17pt");
    expect(fmtDeltaPt(0.001)).toBe("±0pt");
    expect(fmtDeltaPt(null)).toBeNull();
  });
});
