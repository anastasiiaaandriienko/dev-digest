/**
 * L03 intent hooks — GET is a read-only query; POST is an explicit mutation
 * that is never auto-retried; failures are classified for the UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PrIntentState } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, get: (p: string) => get(p), post: (p: string, b: unknown) => post(p, b) } };
});

import { ApiError } from "../api";
import {
  classifyIntentError,
  intentKey,
  usePrIntent,
  useRefreshIntentOnRunsSettled,
  useRunIntent,
} from "./intent";

function state(over: Partial<PrIntentState> = {}): PrIntentState {
  return {
    pr_id: "pr1",
    intent: null,
    meta: null,
    freshness: "unknown",
    stale_reasons: [],
    current_model: null,
    ...over,
  };
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  get.mockReset();
  post.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  // Read-only observers on page-owned keys must never log TanStack's "No queryFn" error.
  expect(consoleError.mock.calls.filter((c: unknown[]) => c.some((a) => String(a).includes("No queryFn")))).toEqual([]);
  consoleError.mockRestore();
});

describe("usePrIntent", () => {
  it("only GETs on mount (never POSTs) and waits until enabled", async () => {
    get.mockResolvedValue(state());
    const { wrapper } = setup();
    const { result, rerender } = renderHook(({ on }) => usePrIntent("pr1", on), {
      wrapper,
      initialProps: { on: false },
    });
    expect(get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");

    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/pulls/pr1/intent");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("useRunIntent", () => {
  it("sends {force} and writes the response into the intent cache", async () => {
    const next = state({ intent: { intent: "x", in_scope: [], out_of_scope: [] }, freshness: "fresh", computed: true });
    post.mockResolvedValue(next);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useRunIntent("pr1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ force: false });
    });
    expect(post).toHaveBeenLastCalledWith("/pulls/pr1/intent", { force: false });
    expect(qc.getQueryData(intentKey("pr1"))).toEqual(next);

    await act(async () => {
      await result.current.mutateAsync({ force: true });
    });
    expect(post).toHaveBeenLastCalledWith("/pulls/pr1/intent", { force: true });
  });

  it("does not retry a failed (paid) call", async () => {
    post.mockRejectedValue(new ApiError("boom", 504, "intent_timeout"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useRunIntent("pr1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ force: false }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it.each([
    [409, "intent_inputs_incomplete", true],
    [422, "intent_model_unavailable", true],
    [502, "external_service_error", false],
  ])("on %s refreshes the intent state via GET only when expected (%s -> %s)", async (status, code, refreshes) => {
    get.mockResolvedValue(state());
    post.mockRejectedValue(new ApiError("m", status, code));
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ q: usePrIntent("pr1"), m: useRunIntent("pr1") }), { wrapper });
    await waitFor(() => expect(result.current.q.data).toBeDefined());
    expect(get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.m.mutateAsync({ force: true }).catch(() => undefined);
    });
    if (refreshes) await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    else await new Promise((r) => setTimeout(r, 20));
    expect(get).toHaveBeenCalledTimes(refreshes ? 2 : 1);
    expect(post).toHaveBeenCalledTimes(1); // never re-POSTs
  });
});

describe("useRefreshIntentOnRunsSettled", () => {
  const activeKey = (id: string) => ["pr-active-runs", id];
  const run = (id: string) => ({ run_id: id, agent_id: null, agent_name: null, ran_at: null });
  const mountBoth = (wrapper: React.ComponentType<{ children: React.ReactNode }>, id = "pr1") =>
    renderHook(({ id }) => ({ q: usePrIntent(id), h: useRefreshIntentOnRunsSettled(id) }), {
      wrapper,
      initialProps: { id },
    });

  it("re-reads intent with exactly one GET when a run disappears (never POSTs)", async () => {
    get.mockResolvedValue(state());
    const { qc, wrapper } = setup();
    qc.setQueryData(activeKey("pr1"), [run("r1")]);
    const { result } = mountBoth(wrapper);
    await waitFor(() => expect(result.current.q.data).toBeDefined());
    expect(get).toHaveBeenCalledTimes(1);

    act(() => qc.setQueryData(activeKey("pr1"), []));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith("/pulls/pr1/intent");
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(2);
    expect(post).not.toHaveBeenCalled();
  });

  it("does nothing on first render or when only the prId changes", async () => {
    get.mockResolvedValue(state());
    const { qc, wrapper } = setup();
    qc.setQueryData(activeKey("pr1"), [run("r1")]);
    qc.setQueryData(activeKey("pr2"), []);
    const { result, rerender } = mountBoth(wrapper);
    await waitFor(() => expect(result.current.q.data).toBeDefined());
    rerender({ id: "pr2" });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/pulls/pr2/intent"));
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(2); // one initial read per PR, no extra invalidation
    expect(post).not.toHaveBeenCalled();
  });

  it("on mount, an empty active-runs list newer than the intent data triggers one GET", async () => {
    get.mockResolvedValue(state());
    // fresh (staleTime 30s) cache like the app: the only GET must come from the mount guard
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    qc.setQueryData(intentKey("pr1"), state(), { updatedAt: Date.now() - 10_000 });
    qc.setQueryData(activeKey("pr1"), [], { updatedAt: Date.now() });
    renderHook(() => ({ q: usePrIntent("pr1"), h: useRefreshIntentOnRunsSettled("pr1") }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("page-owned active-runs query (with queryFn) refetched while the hook is mounted: one intent GET, no queryFn error", async () => {
    let activeRuns = [run("r1")];
    get.mockImplementation((p: string) =>
      Promise.resolve(p === "/pulls/pr1/active-runs" ? activeRuns : state()),
    );
    const { qc, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        page: useQuery({ queryKey: ["pr-active-runs", "pr1"], queryFn: () => get("/pulls/pr1/active-runs") }),
        q: usePrIntent("pr1"),
        h: useRefreshIntentOnRunsSettled("pr1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.page.data).toHaveLength(1));
    await waitFor(() => expect(result.current.q.data).toBeDefined());
    const intentGets = () => get.mock.calls.filter(([p]) => p === "/pulls/pr1/intent").length;
    expect(intentGets()).toBe(1);

    activeRuns = [];
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["pr-active-runs", "pr1"] });
    });
    await waitFor(() => expect(intentGets()).toBe(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(intentGets()).toBe(2);
    expect(post).not.toHaveBeenCalled();
  });

  it("repeated identical active-runs updates cause no GETs", async () => {
    get.mockResolvedValue(state());
    const { qc, wrapper } = setup();
    qc.setQueryData(activeKey("pr1"), [run("r1")]);
    const { result } = mountBoth(wrapper);
    await waitFor(() => expect(result.current.q.data).toBeDefined());
    for (let i = 0; i < 3; i++) {
      act(() => qc.setQueryData(activeKey("pr1"), [run("r1")]));
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("classifyIntentError", () => {
  it.each([
    [new ApiError("m", 409, "intent_inputs_incomplete"), "inputs_incomplete"],
    [new ApiError("m", 422, "intent_model_unavailable"), "model_unavailable"],
    [new ApiError("m", 429), "rate_limited"],
    [new ApiError("m", 502, "external_service_error"), "provider_error"],
    [new ApiError("m", 504, "intent_timeout"), "timeout"],
    [new ApiError("m", 500, "intent_save_failed"), "save_failed"],
    [new ApiError("m", 500, "internal_error"), "unknown"],
    [new ApiError("m", 500), "unknown"],
    [new ApiError("m", 404), "not_found"],
    [new ApiError("m", 422), "unknown"],
    [new Error("x"), "unknown"],
  ])("%#", (err, kind) => {
    expect(classifyIntentError(err)).toBe(kind);
  });
});
