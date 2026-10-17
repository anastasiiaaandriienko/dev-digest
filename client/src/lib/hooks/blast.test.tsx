/**
 * HW-04 blast hook — a GET-only read of /pulls/:id/blast that waits until enabled
 * (the Overview enables it once the PR detail has settled).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, get: (p: string) => get(p), post: (p: string, b: unknown) => post(p, b) } };
});

import { blastKey, useBlastRadius } from "./blast";
import { intentKey, usePullSettled } from "./intent";

const BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: "s" };

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("useBlastRadius", () => {
  it("only GETs /pulls/:id/blast, and only once enabled", async () => {
    get.mockResolvedValue(BLAST);
    const { result, rerender } = renderHook(({ on }) => useBlastRadius("pr1", on), {
      wrapper,
      initialProps: { on: false },
    });
    expect(get).not.toHaveBeenCalled();

    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toEqual(BLAST));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/pulls/pr1/blast");
    expect(post).not.toHaveBeenCalled();
  });

  it("does nothing without a PR id", () => {
    renderHook(() => useBlastRadius(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("uses its own query key", () => {
    expect(blastKey("pr1")).toEqual(["pr-blast", "pr1"]);
  });
});

describe("usePullSettled(prId, blastKey)", () => {
  it("re-reads a blast radius older than the settled PR detail, and leaves the intent alone", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    qc.setQueryData(blastKey("pr1"), BLAST, { updatedAt: 1_000 });
    qc.setQueryData(intentKey("pr1"), { pr_id: "pr1" }, { updatedAt: 1_000 });
    qc.setQueryData(["pull", "pr1"], { id: "pr1" }, { updatedAt: 2_000 });

    const { result } = renderHook(() => usePullSettled("pr1", blastKey), { wrapper: w });

    await waitFor(() => expect(result.current).toBe(true));
    await waitFor(() => expect(qc.getQueryState(blastKey("pr1"))?.isInvalidated).toBe(true));
    expect(qc.getQueryState(intentKey("pr1"))?.isInvalidated).toBe(false);
    expect(get).not.toHaveBeenCalled(); // no observer on the blast key here → nothing fetched
  });
});
