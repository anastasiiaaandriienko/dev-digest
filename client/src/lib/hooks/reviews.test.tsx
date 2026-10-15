/**
 * L01 cost refresh — when a run settles, its cost lands in the PR list total
 * and the run's trace, so those caches must be invalidated (the timeline is the
 * `pr-runs` data that triggered the check).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RunSummary } from "@devdigest/shared";
import { settledRunIds, useRefreshCostOnRunSettled } from "./reviews";

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
