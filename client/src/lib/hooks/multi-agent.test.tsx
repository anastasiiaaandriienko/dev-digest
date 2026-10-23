/**
 * L07 T7 — Multi-Agent Review hooks against a real QueryClient with the HTTP
 * layer mocked: URLs and bodies, polling while a column runs, cache
 * invalidation on start, and the multi-agent refresh added to the existing
 * delete-run / finding-action hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiAgentRun } from "@devdigest/shared";

// Plain stubs (not vi.fn) — see evals.test.tsx for why.
let getImpl: (path: string) => Promise<unknown> = async () => undefined;
let postImpl: (path: string, body?: unknown) => Promise<unknown> = async () => undefined;
const calls: { method: string; path: string; body?: unknown }[] = [];
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      get: (path: string) => {
        calls.push({ method: "GET", path });
        return getImpl(path);
      },
      post: (path: string, body?: unknown) => {
        calls.push({ method: "POST", path, body });
        return postImpl(path, body);
      },
      del: async (path: string) => {
        calls.push({ method: "DELETE", path });
        return { ok: true };
      },
    },
  };
});

import { ApiError } from "../api";
import {
  AGENT_ESTIMATES_KEY,
  multiAgentKey,
  useAgentEstimates,
  useMultiAgentRun,
  useStartMultiAgentRun,
} from "./multi-agent";
import { useDeleteRun, useFindingAction } from "./reviews";

function multiRun(statuses: ("done" | "running" | "failed")[]): MultiAgentRun {
  return {
    id: "multi-1",
    pr_id: "pr-1",
    pr_number: 482,
    ran_at: "2026-10-23T10:00:00.000Z",
    agent_count: statuses.length,
    total_duration_ms: 0,
    wall_clock_ms: null,
    total_cost_usd: null,
    cost_partial: false,
    columns: statuses.map((status, i) => ({
      run_id: `run-${i}`,
      agent_id: `agent-${i}`,
      agent_name: `Agent ${i}`,
      provider: "openai",
      model: "m",
      status,
      error: null,
      verdict: null,
      score: null,
      summary: null,
      duration_ms: null,
      cost_usd: null,
      findings: [],
    })),
    groups: [],
    conflicts: [],
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const invalidatedKeys = () => invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
  return { qc, wrapper, invalidatedKeys };
}

beforeEach(() => {
  calls.length = 0;
  getImpl = async () => undefined;
  postImpl = async () => undefined;
});

describe("useMultiAgentRun", () => {
  it("GETs /pulls/:id/multi-agent under the ['multi-agent', prId] key", async () => {
    getImpl = async () => ({ multi_run: multiRun(["done"]) });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMultiAgentRun("pr-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([{ method: "GET", path: "/pulls/pr-1/multi-agent" }]);
    expect(result.current.data?.multi_run?.id).toBe("multi-1");
    expect(qc.getQueryData(multiAgentKey("pr-1"))).toEqual(result.current.data);
  });

  it("passes { multi_run: null } through (no multi-run yet, AC-MAR-10)", async () => {
    getImpl = async () => ({ multi_run: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useMultiAgentRun("pr-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ multi_run: null });
  });

  it("does not fetch without a PR id", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMultiAgentRun(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toEqual([]);
  });

  it("polls every 4 s while a column runs, and stops once all are terminal", async () => {
    getImpl = async () => ({ multi_run: multiRun(["done", "running"]) });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useMultiAgentRun("pr-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const query = qc.getQueryCache().find({ queryKey: multiAgentKey("pr-1") })!;
    // The observer options carry refetchInterval; the base QueryOptions type does not declare it.
    const interval = (query.options as { refetchInterval?: unknown }).refetchInterval as (
      q: typeof query
    ) => number | false;
    expect(interval(query)).toBe(4000);
    qc.setQueryData(multiAgentKey("pr-1"), { multi_run: multiRun(["done", "failed"]) });
    expect(interval(query)).toBe(false);
    qc.setQueryData(multiAgentKey("pr-1"), { multi_run: null });
    expect(interval(query)).toBe(false);
  });

  it("surfaces an API error (e.g. 404 PR outside the workspace) as a query error", async () => {
    getImpl = async () => Promise.reject(new ApiError("Pull request not found", 404, "not_found"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useMultiAgentRun("pr-x"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(404);
  });
});

describe("useAgentEstimates", () => {
  it("GETs /multi-agent/estimates under a workspace-wide key", async () => {
    getImpl = async () => [{ agent_id: "a", runs: 2, avg_duration_ms: 8200, avg_cost_usd: 0.04 }];
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useAgentEstimates(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([{ method: "GET", path: "/multi-agent/estimates" }]);
    expect(qc.getQueryData(AGENT_ESTIMATES_KEY)).toEqual(result.current.data);
  });
});

describe("useStartMultiAgentRun", () => {
  it("POSTs { agentIds } to /pulls/:id/review and refreshes the PR's run caches", async () => {
    postImpl = async () => ({ pr_id: "pr-1", runs: [], reviews: [], multi_agent_run_id: "multi-1" });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useStartMultiAgentRun(), { wrapper });
    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync({ prId: "pr-1", agentIds: ["a1", "a2"] });
    });
    expect(calls).toEqual([{ method: "POST", path: "/pulls/pr-1/review", body: { agentIds: ["a1", "a2"] } }]);
    expect(data).toMatchObject({ multi_agent_run_id: "multi-1" });
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([
        ["multi-agent", "pr-1"],
        ["pr-active-runs", "pr-1"],
        ["pr-runs", "pr-1"],
        ["reviews", "pr-1"],
      ])
    );
  });

  it("a failed start rejects (the global handler toasts) and invalidates nothing", async () => {
    postImpl = async () => Promise.reject(new ApiError("Agent not found", 404, "not_found"));
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useStartMultiAgentRun(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ prId: "pr-1", agentIds: ["x"] })).rejects.toMatchObject({
        code: "not_found",
      });
    });
    expect(invalidatedKeys()).toEqual([]);
  });
});

describe("existing hooks also refresh the multi-agent results", () => {
  it("useDeleteRun invalidates ['multi-agent', prId] (AC-MAR-57) — besides its existing keys", async () => {
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useDeleteRun("pr-1", "repo-1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("run-1");
    });
    expect(invalidatedKeys()).toEqual(
      expect.arrayContaining([["pr-runs", "pr-1"], ["reviews", "pr-1"], ["pulls", "repo-1"], ["multi-agent", "pr-1"]])
    );
  });

  it("useFindingAction invalidates ['multi-agent', prId] on settle (AC-MAR-38)", async () => {
    postImpl = async () => ({ finding: { id: "f1", accepted_at: "2026-10-23T10:00:00.000Z", dismissed_at: null } });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useFindingAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ findingId: "f1", action: "accept", prId: "pr-1" });
    });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining([["reviews", "pr-1"], ["multi-agent", "pr-1"]]));
  });
});
