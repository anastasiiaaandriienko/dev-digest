/**
 * L06 eval hooks — useCreateEvalCase against a real QueryClient with the HTTP
 * layer mocked: the cached reviews list gets the new `eval_case_id` at once
 * ("In eval set" without a reload), a 409 eval_case_exists is reflected the same
 * way, and other errors leave the cache alone. L07: the cached multi-agent run
 * ("multi-agent", prId) is patched the same way, in place, without a refetch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumnFinding, FindingRecord, MultiAgentRun, ReviewRecord } from "@devdigest/shared";

// A plain stub (not vi.fn): with Vitest 2.1 a vi.fn whose implementation rejects is
// reported as an unhandled rejection after a mockClear/mockReset, even when the
// caller catches it. Each test sets `postImpl`; `postCalls` records the calls.
let postImpl: (...a: unknown[]) => Promise<unknown> = async () => undefined;
const postCalls: unknown[][] = [];
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      post: (...a: unknown[]) => {
        postCalls.push(a);
        return postImpl(...a);
      },
      get: async () => undefined,
    },
  };
});

import { ApiError } from "../api";
import { existingEvalCaseId, patchEvalCaseId, patchMultiAgentEvalCaseId, useCreateEvalCase } from "./evals";

function f(id: string, o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev",
    accepted_at: "2026-10-22T00:00:00.000Z",
    dismissed_at: null,
    eval_case_id: null,
    ...o,
  };
}

const REVIEWS: ReviewRecord[] = [
  {
    id: "rev",
    pr_id: "pr1",
    agent_id: "agent-1",
    run_id: "run",
    agent_name: "A",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 50,
    model: null,
    grounding: null,
    created_at: "2026-10-22T00:00:00.000Z",
    findings: [f("f1"), f("f2")],
  },
];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(["reviews", "pr1"], REVIEWS);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useCreateEvalCase(), { wrapper });
  const cachedCaseId = (id: string) =>
    qc.getQueryData<ReviewRecord[]>(["reviews", "pr1"])![0]!.findings.find((x) => x.id === id)!.eval_case_id;
  return { qc, result, cachedCaseId };
}

beforeEach(() => {
  postCalls.length = 0;
  postImpl = async () => undefined;
});

describe("patchEvalCaseId / existingEvalCaseId", () => {
  it("sets eval_case_id on one finding only", () => {
    const out = patchEvalCaseId(REVIEWS, "f2", "c9")!;
    expect(out[0]!.findings.map((x) => x.eval_case_id)).toEqual([null, "c9"]);
    expect(patchEvalCaseId(undefined, "f2", "c9")).toBeUndefined();
  });

  it("reads the existing case id only from a 409 eval_case_exists", () => {
    expect(existingEvalCaseId(new ApiError("x", 409, "eval_case_exists", { eval_case_id: "c1" }))).toBe("c1");
    expect(existingEvalCaseId(new ApiError("x", 409, "duplicate_location", { eval_case_id: "c1" }))).toBeNull();
    expect(existingEvalCaseId(new Error("x"))).toBeNull();
  });
});

describe("useCreateEvalCase", () => {
  it("posts the body and marks the finding In eval set in the cached reviews", async () => {
    postImpl = async () => ({ id: "case-1", agent_id: "agent-1" });
    const { result, cachedCaseId } = setup();
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", body: { name: "must-find-f1" } });
    });
    expect(postCalls).toEqual([["/findings/f1/eval-case", { name: "must-find-f1" }]]);
    await waitFor(() => expect(cachedCaseId("f1")).toBe("case-1"));
    expect(cachedCaseId("f2")).toBeNull();
  });

  it("reflects a 409 eval_case_exists as In eval set", async () => {
    postImpl = async () => {
      throw new ApiError("exists", 409, "eval_case_exists", { eval_case_id: "case-old" });
    };
    const { result, cachedCaseId } = setup();
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f2", body: { name: "x" } }).catch(() => undefined);
    });
    await waitFor(() => expect(cachedCaseId("f2")).toBe("case-old"));
  });

  it("leaves the cache alone on other errors", async () => {
    postImpl = async () => {
      throw new ApiError("dup", 409, "duplicate_location", { eval_case_id: "other" });
    };
    const { result, cachedCaseId } = setup();
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", body: { name: "x" } }).catch(() => undefined);
    });
    expect(cachedCaseId("f1")).toBeNull();
  });
});

// ---- L07: the Multi-Agent Review results show the same "In eval set" badge ----

function columnFinding(id: string): AgentColumnFinding {
  return {
    id,
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "a.ts",
    start_line: 1,
    kind: "finding",
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    review_id: "rev",
    accepted_at: "2026-10-22T00:00:00.000Z",
    dismissed_at: null,
    eval_case_id: null,
  };
}

function multiRunState(findingIds: string[][]): { multi_run: MultiAgentRun } {
  return {
    multi_run: {
      id: "multi-1",
      pr_id: "pr1",
      pr_number: 482,
      ran_at: "2026-10-22T00:00:00.000Z",
      agent_count: findingIds.length,
      total_duration_ms: 0,
      wall_clock_ms: null,
      total_cost_usd: null,
      cost_partial: false,
      columns: findingIds.map((ids, i) => ({
        run_id: `run-${i}`,
        agent_id: `agent-${i}`,
        agent_name: `Agent ${i}`,
        provider: "openai",
        model: "m",
        status: "done" as const,
        error: null,
        verdict: null,
        score: null,
        summary: null,
        duration_ms: null,
        cost_usd: null,
        findings: ids.map(columnFinding),
      })),
      groups: [],
      conflicts: [],
    },
  };
}

describe("useCreateEvalCase — Multi-Agent Review cache (L07)", () => {
  function setupMulti() {
    const s = setup();
    s.qc.setQueryData(["multi-agent", "pr1"], multiRunState([["f1"], ["f2"]]));
    s.qc.setQueryData(["multi-agent", "pr-other"], multiRunState([["zz"]]));
    s.qc.setQueryData(["multi-agent-estimates"], [{ agent_id: "agent-0", runs: 1, avg_duration_ms: 1, avg_cost_usd: 1 }]);
    const multiCaseId = (id: string) =>
      s.qc
        .getQueryData<{ multi_run: MultiAgentRun }>(["multi-agent", "pr1"])!
        .multi_run.columns.flatMap((c) => c.findings)
        .find((x) => x.id === id)!.eval_case_id;
    return { ...s, multiCaseId };
  }

  it("patchMultiAgentEvalCaseId sets eval_case_id on that finding only, and is a no-op otherwise", () => {
    const state = multiRunState([["f1", "f3"], ["f2"]]);
    const out = patchMultiAgentEvalCaseId(state, "f3", "c9")!;
    expect(out.multi_run!.columns.map((c) => c.findings.map((x) => x.eval_case_id))).toEqual([[null, "c9"], [null]]);
    expect(out.multi_run!.columns[1]).toBe(state.multi_run.columns[1]); // untouched column kept by reference
    expect(patchMultiAgentEvalCaseId(state, "missing", "c9")).toBe(state);
    const empty = { multi_run: null };
    expect(patchMultiAgentEvalCaseId(empty, "f1", "c9")).toBe(empty);
    expect(patchMultiAgentEvalCaseId(undefined, "f1", "c9")).toBeUndefined();
  });

  it("success: the cached multi-agent run shows In eval set at once, without a refetch", async () => {
    postImpl = async () => ({ id: "case-7", agent_id: "agent-0" });
    const { qc, result, multiCaseId, cachedCaseId } = setupMulti();
    const otherBefore = qc.getQueryData(["multi-agent", "pr-other"]);
    const estimatesBefore = qc.getQueryData(["multi-agent-estimates"]);
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", body: { name: "x" } });
    });
    expect(multiCaseId("f1")).toBe("case-7");
    expect(multiCaseId("f2")).toBeNull();
    // The ordinary review page cache is still patched (unchanged behaviour).
    await waitFor(() => expect(cachedCaseId("f1")).toBe("case-7"));
    // Unrelated caches untouched; the multi-agent query is not invalidated (no extra request).
    expect(qc.getQueryData(["multi-agent", "pr-other"])).toBe(otherBefore);
    expect(qc.getQueryData(["multi-agent-estimates"])).toBe(estimatesBefore);
    expect(qc.getQueryState(["multi-agent", "pr1"])!.isInvalidated).toBe(false);
    expect(postCalls).toHaveLength(1);
  });

  it("a 409 eval_case_exists also marks the multi-agent finding", async () => {
    postImpl = async () => {
      throw new ApiError("exists", 409, "eval_case_exists", { eval_case_id: "case-old" });
    };
    const { result, multiCaseId } = setupMulti();
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f2", body: { name: "x" } }).catch(() => undefined);
    });
    expect(multiCaseId("f2")).toBe("case-old");
  });

  it("any other error leaves the multi-agent cache alone (no false update)", async () => {
    postImpl = async () => {
      throw new ApiError("dup", 409, "duplicate_location", { eval_case_id: "other" });
    };
    const { qc, result, multiCaseId } = setupMulti();
    const before = qc.getQueryData(["multi-agent", "pr1"]);
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", body: { name: "x" } }).catch(() => undefined);
    });
    expect(multiCaseId("f1")).toBeNull();
    expect(qc.getQueryData(["multi-agent", "pr1"])).toBe(before);
  });
});
