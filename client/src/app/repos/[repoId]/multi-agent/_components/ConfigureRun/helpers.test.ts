import { describe, it, expect } from "vitest";
import type { AgentEstimate, PrMeta } from "@devdigest/shared";
import {
  estimateTotals,
  formatEstimateDuration,
  pullFromQuery,
  selectAllAgents,
  selectablePulls,
  usableEstimate,
} from "./helpers";

/** L07 T9 — Configure run pure rules (AC-MAR-20, 29, 30). */

const est = (agent_id: string, runs: number, avg_duration_ms: number | null, avg_cost_usd: number | null): AgentEstimate => ({
  agent_id,
  runs,
  avg_duration_ms,
  avg_cost_usd,
});
const map = (...es: AgentEstimate[]) => new Map(es.map((e) => [e.agent_id, e]));

describe("estimateTotals (AC-MAR-20)", () => {
  it("time = the slowest selected agent (parallel), cost = the sum", () => {
    const m = map(est("a", 5, 8200, 0.04), est("b", 3, 7100, 0.05), est("c", 2, 6900, 0.06));
    const totals = estimateTotals(["a", "b", "c"], m);
    expect(totals.durationMs).toBe(8200);
    expect(totals.costUsd).toBeCloseTo(0.15, 10);
    expect(totals.partial).toBe(false);
  });

  it("agents without history are left out and the total is marked partial", () => {
    const totals = estimateTotals(["a", "new"], map(est("a", 2, 5000, 0.02), est("new", 0, null, null)));
    expect(totals).toEqual({ durationMs: 5000, costUsd: 0.02, partial: true });
    expect(estimateTotals(["a", "missing"], map(est("a", 2, 5000, 0.02))).partial).toBe(true);
  });

  it("a known duration with an unknown cost (and vice versa) is partial, never guessed", () => {
    expect(estimateTotals(["a", "b"], map(est("a", 1, 4000, null), est("b", 1, null, 0.03)))).toEqual({
      durationMs: 4000,
      costUsd: 0.03,
      partial: true,
    });
  });

  it("nothing known → both null; nothing selected → empty, not partial", () => {
    expect(estimateTotals(["x"], map())).toEqual({ durationMs: null, costUsd: null, partial: true });
    expect(estimateTotals([], map(est("a", 1, 1, 1)))).toEqual({ durationMs: null, costUsd: null, partial: false });
  });

  it("usableEstimate rejects no-history and all-null rows", () => {
    expect(usableEstimate(undefined)).toBeNull();
    expect(usableEstimate(est("a", 0, null, null))).toBeNull();
    expect(usableEstimate(est("a", 3, null, null))).toBeNull();
    expect(usableEstimate(est("a", 3, 100, null))).not.toBeNull();
  });
});

describe("formatEstimateDuration", () => {
  it("formats seconds and minutes; unknown is a dash", () => {
    expect(formatEstimateDuration(8200)).toBe("8.2s");
    expect(formatEstimateDuration(450)).toBe("0.5s");
    expect(formatEstimateDuration(65_000)).toBe("1m 05s");
    expect(formatEstimateDuration(null)).toBe("—");
    expect(formatEstimateDuration(-1)).toBe("—");
  });
});

describe("selectAllAgents", () => {
  it("keeps the current picks and order, adds the rest in list order, up to 8", () => {
    const agents = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` }));
    expect(selectAllAgents(["a5", "a2"], agents)).toEqual(["a5", "a2", "a0", "a1", "a3", "a4", "a6", "a7"]);
    expect(selectAllAgents([], [{ id: "x" }, { id: "y" }])).toEqual(["x", "y"]);
  });
});

describe("PR selection (AC-MAR-30)", () => {
  const pr = (id: string | null, number: number) => ({ id, number, title: `PR ${number}` }) as PrMeta;

  it("lists only stored PRs (with an id) and resolves ?pr= against them", () => {
    const pulls = selectablePulls([pr("p1", 1), pr(null, 2), pr("p3", 3)]);
    expect(pulls.map((p) => p.number)).toEqual([1, 3]);
    expect(pullFromQuery(pulls, "p3")?.number).toBe(3);
    expect(pullFromQuery(pulls, "nope")).toBeNull();
    expect(pullFromQuery(pulls, null)).toBeNull();
    expect(selectablePulls(undefined)).toEqual([]);
  });
});
