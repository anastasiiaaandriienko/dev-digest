/**
 * L01 Accept / Reject — useFindingAction against a real QueryClient with the
 * HTTP layer mocked: optimistic update of ["reviews", prId], per-finding
 * rollback on failure, refetch on settle, and per-card status (A3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

const post = vi.fn();
vi.mock("../api", () => ({ api: { post: (...a: unknown[]) => post(...a) }, API_BASE: "" }));

import {
  decisionFields,
  latestDecisionStatus,
  patchFinding,
  useFindingAction,
  useFindingDecisionStatus,
} from "./reviews";

function f(id: string, o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: "CRITICAL",
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
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const REVIEWS: ReviewRecord[] = [
  {
    id: "rev",
    pr_id: "pr1",
    agent_id: null,
    run_id: "run",
    agent_name: "A",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 50,
    model: null,
    grounding: null,
    created_at: "2026-10-11T00:00:00.000Z",
    findings: [f("f1"), f("f2", { accepted_at: "2026-01-01T00:00:00.000Z" })],
  },
];

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(["reviews", "pr1"], REVIEWS);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({ action: useFindingAction(), status: useFindingDecisionStatus() }), { wrapper });
  const finding = (id: string) =>
    qc.getQueryData<ReviewRecord[]>(["reviews", "pr1"])![0]!.findings.find((x) => x.id === id)!;
  return { qc, hook, finding, invalidate };
}

beforeEach(() => post.mockReset());

describe("useFindingAction", () => {
  it("posts to the existing endpoint and updates the cache optimistically (before the server answers)", async () => {
    const d = deferred<unknown>();
    post.mockReturnValue(d.promise);
    const { hook, finding, invalidate } = setup();

    act(() => hook.result.current.action.mutate({ findingId: "f1", action: "dismiss", prId: "pr1" }));
    // The cache flips before the request (onMutate awaits cancelQueries first).
    await waitFor(() => expect(finding("f1").dismissed_at).not.toBeNull());
    await waitFor(() => expect(post).toHaveBeenCalledWith("/findings/f1/dismiss", undefined));
    expect(finding("f1").accepted_at).toBeNull();
    expect(hook.result.current.status.get("f1")).toBe("pending");

    await act(async () => d.resolve({ finding: {} }));
    await waitFor(() => expect(hook.result.current.status.get("f1")).toBe("success"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["reviews", "pr1"] });
  });

  it("A3: a failure rolls back only that finding and reports an error status", async () => {
    const d1 = deferred<unknown>();
    const d2 = deferred<unknown>();
    post.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    // No query observer is mounted, so the settle-time invalidation marks the
    // cache stale without refetching: what we read is the optimistic state.
    const { hook, finding } = setup();

    act(() => hook.result.current.action.mutate({ findingId: "f1", action: "accept", prId: "pr1" }));
    act(() => hook.result.current.action.mutate({ findingId: "f2", action: "dismiss", prId: "pr1" }));
    await waitFor(() => expect(finding("f1").accepted_at).not.toBeNull());
    await waitFor(() => expect(finding("f2").dismissed_at).not.toBeNull());

    await act(async () => d1.reject(new Error("500")));
    await waitFor(() => expect(hook.result.current.status.get("f1")).toBe("error"));
    // f1 back to undecided; f2's in-flight optimistic decision is untouched.
    expect(finding("f1").accepted_at).toBeNull();
    expect(finding("f1").dismissed_at).toBeNull();
    expect(finding("f2").dismissed_at).not.toBeNull();
    expect(finding("f2").accepted_at).toBeNull();

    await act(async () => d2.resolve({ finding: {} }));
    await waitFor(() => expect(hook.result.current.status.get("f2")).toBe("success"));
  });
});

describe("decision helpers", () => {
  it("decisionFields: accept and dismiss exclude each other; other actions change nothing", () => {
    expect(decisionFields("accept", "t")).toEqual({ accepted_at: "t", dismissed_at: null });
    expect(decisionFields("dismiss", "t")).toEqual({ accepted_at: null, dismissed_at: "t" });
    expect(decisionFields("learn", "t")).toBeNull();
  });

  it("patchFinding changes only the target finding and keeps others by reference", () => {
    const next = patchFinding(REVIEWS, "f1", { accepted_at: "t", dismissed_at: null })!;
    expect(next[0]!.findings[0]!.accepted_at).toBe("t");
    expect(next[0]!.findings[1]).toBe(REVIEWS[0]!.findings[1]);
    expect(patchFinding(undefined, "f1", { accepted_at: "t", dismissed_at: null })).toBeUndefined();
  });

  it("latestDecisionStatus keeps the most recent request per finding", () => {
    const m = latestDecisionStatus([
      { id: "a", status: "error", at: 1 },
      { id: "a", status: "pending", at: 2 },
      { id: "b", status: "success", at: 1 },
      { status: "pending", at: 3 },
    ]);
    expect(m.get("a")).toBe("pending");
    expect(m.get("b")).toBe("success");
    expect(m.size).toBe(2);
  });
});
