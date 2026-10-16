/**
 * L01 cost refresh — when a run settles, its cost lands in the PR list total
 * and the run's trace, so those caches must be invalidated (the timeline is the
 * `pr-runs` data that triggered the check).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { RunSummary } from "@devdigest/shared";
import {
  settledRunIds,
  useRefreshCostOnRunSettled,
  finishedActiveRunIds,
  useRefreshReviewsOnRunsSettled,
  type ActiveRun,
} from "./reviews";

function run(run_id: string, status: string): RunSummary {
  return {
    run_id,
    agent_id: null,
    agent_name: null,
    provider: null,
    model: null,
    status,
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    findings_count: null,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
    cost_usd: null,
  };
}

describe("settledRunIds", () => {
  it("returns runs that left running (done, failed or cancelled)", () => {
    const prev = [run("a", "running"), run("b", "running"), run("c", "running"), run("d", "done")];
    const next = [run("a", "done"), run("b", "failed"), run("c", "running"), run("d", "done")];
    expect(settledRunIds(prev, next)).toEqual(["a", "b"]);
  });

  it("ignores the first snapshot and runs that were never running", () => {
    expect(settledRunIds(undefined, [run("a", "done")])).toEqual([]);
    expect(settledRunIds([run("a", "done")], [run("a", "done")])).toEqual([]);
  });

  it("ignores a running run deleted from the list", () => {
    expect(settledRunIds([run("a", "running")], [])).toEqual([]);
  });
});

describe("useRefreshCostOnRunSettled", () => {
  function setup(repoId: string | null) {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(({ runs }: { runs: RunSummary[] | undefined }) => useRefreshCostOnRunSettled(runs, repoId), {
      wrapper,
      initialProps: { runs: undefined as RunSummary[] | undefined },
    });
    const keys = () => spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    return { hook, spy, keys };
  }

  it("does nothing while runs are still running", () => {
    const { hook, spy } = setup("repo-1");
    hook.rerender({ runs: [run("a", "running")] });
    hook.rerender({ runs: [run("a", "running")] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes the PR list total and the settled run's trace when a run finishes", () => {
    const { hook, keys } = setup("repo-1");
    hook.rerender({ runs: [run("a", "running"), run("b", "done")] });
    hook.rerender({ runs: [run("a", "done"), run("b", "done")] });
    expect(keys()).toEqual([["pulls", "repo-1"], ["run-trace", "a"]]);
  });

  it("falls back to every PR list when the repo is unknown", () => {
    const { hook, keys } = setup(null);
    hook.rerender({ runs: [run("a", "running")] });
    hook.rerender({ runs: [run("a", "failed")] });
    expect(keys()).toEqual([["pulls"], ["run-trace", "a"]]);
  });
});

function active(run_id: string): ActiveRun {
  return { run_id, agent_id: null, agent_name: null, ran_at: null };
}

describe("finishedActiveRunIds", () => {
  const A = active("A");
  const B = active("B");

  it("returns [] while either side is unknown", () => {
    expect(finishedActiveRunIds(undefined, [A])).toEqual([]);
    expect(finishedActiveRunIds(null, [A])).toEqual([]);
    expect(finishedActiveRunIds([A], undefined)).toEqual([]);
    expect(finishedActiveRunIds(undefined, undefined)).toEqual([]);
    expect(finishedActiveRunIds(null, undefined)).toEqual([]);
  });

  it("returns ids removed from the list", () => {
    expect(finishedActiveRunIds([A], [])).toEqual(["A"]);
    expect(finishedActiveRunIds([A, B], [B])).toEqual(["A"]);
  });

  it("returns [] when ids are unchanged or only added", () => {
    expect(finishedActiveRunIds([A], [active("A")])).toEqual([]);
    expect(finishedActiveRunIds([], [A])).toEqual([]);
    expect(finishedActiveRunIds([A], [A, B])).toEqual([]);
  });
});

describe("useRefreshReviewsOnRunsSettled", () => {
  const A = active("A");
  const B = active("B");
  type Props = { runs: ActiveRun[] | undefined; prId?: string; repoId?: string | null };

  function setup(initial: Props = { runs: undefined }) {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ runs, prId = "pr-1", repoId = "repo-1" }: Props) => useRefreshReviewsOnRunsSettled(runs, prId, repoId),
      { wrapper, initialProps: initial },
    );
    const keys = () => spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    return { qc, hook, spy, keys };
  }

  it("does nothing on first load, even with active runs", () => {
    const { hook, spy } = setup();
    expect(spy).toHaveBeenCalledTimes(0);
    hook.rerender({ runs: [A] });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("invalidates reviews, pr-runs and pulls once when a run disappears", () => {
    const { hook, spy, keys } = setup();
    hook.rerender({ runs: [A] });
    hook.rerender({ runs: [] });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(keys()).toEqual([["reviews", "pr-1"], ["pr-runs", "pr-1"], ["pulls", "repo-1"]]);
    hook.rerender({ runs: [] });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the same run stays active (new array reference)", () => {
    const { hook, spy } = setup();
    hook.rerender({ runs: [A] });
    hook.rerender({ runs: [active("A")] });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("fires once when one of two runs finishes, not again for the remaining one", () => {
    const { hook, spy } = setup();
    hook.rerender({ runs: [A, B] });
    hook.rerender({ runs: [B] });
    expect(spy).toHaveBeenCalledTimes(3);
    hook.rerender({ runs: [active("B")] });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("an undefined (loading) snapshot resets the baseline", () => {
    const { hook, spy } = setup();
    hook.rerender({ runs: [A] });
    hook.rerender({ runs: undefined });
    hook.rerender({ runs: [] });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("falls back to every PR list when repoId is falsy", () => {
    const { hook, keys } = setup();
    hook.rerender({ runs: [A], repoId: null });
    hook.rerender({ runs: [], repoId: null });
    expect(keys()).toEqual([["reviews", "pr-1"], ["pr-runs", "pr-1"], ["pulls"]]);
  });

  it("resets the baseline on prId change: switching PRs never invalidates", () => {
    const { hook, spy } = setup();
    hook.rerender({ runs: [A], prId: "pr-1" });
    // new PR's cached runs list is [] -> must not look like "A finished"
    hook.rerender({ runs: [], prId: "pr-2" });
    expect(spy).toHaveBeenCalledTimes(0);
    // and a later change inside pr-2 is measured against pr-2's own baseline
    hook.rerender({ runs: [B], prId: "pr-2" });
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("on the same prId a finished run still fires the 3 invalidations", () => {
    const { hook, spy, keys } = setup();
    hook.rerender({ runs: [A], prId: "pr-2" });
    hook.rerender({ runs: [], prId: "pr-2" });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(keys()).toEqual([["reviews", "pr-2"], ["pr-runs", "pr-2"], ["pulls", "repo-1"]]);
  });

  it("a run finishing after a PR switch is detected against the new PR's baseline", () => {
    const { hook, keys } = setup();
    hook.rerender({ runs: [A], prId: "pr-1" });
    hook.rerender({ runs: [B], prId: "pr-2" });
    hook.rerender({ runs: [], prId: "pr-2" });
    expect(keys()).toEqual([["reviews", "pr-2"], ["pr-runs", "pr-2"], ["pulls", "repo-1"]]);
  });

  it("refetches an active reviews query only after the run finishes", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryFn = vi.fn(async () => []);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      ({ runs }: { runs: ActiveRun[] | undefined }) => {
        useQuery({ queryKey: ["reviews", "pr-1"], queryFn });
        useRefreshReviewsOnRunsSettled(runs, "pr-1", "repo-1");
      },
      { wrapper, initialProps: { runs: undefined as ActiveRun[] | undefined } },
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    hook.rerender({ runs: [A] });
    hook.rerender({ runs: [active("A")] });
    expect(queryFn).toHaveBeenCalledTimes(1);
    hook.rerender({ runs: [] });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  });
});
