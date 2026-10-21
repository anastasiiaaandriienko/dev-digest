/**
 * Project Context hooks against a real QueryClient with the HTTP layer mocked:
 * attach / detach invalidate the usage key (AC-CTX-126); the usage query does
 * not retry (AC-CTX-125).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("../api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), del: (...a: unknown[]) => del(...a) },
  API_BASE: "",
}));

import { contextUsageKey, useAttachContextDoc, useContextUsage, useDetachContextDoc } from "./context";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  get.mockReset();
  post.mockReset();
  del.mockReset();
});

describe("context usage hooks", () => {
  it("AC-CTX-126 attach success invalidates ['context', repoId, 'usage']", async () => {
    post.mockResolvedValue({ id: "d1" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAttachContextDoc("agents", "ag", "r1"), { wrapper });
    act(() => result.current.mutate("docs/spec.md"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["context", "r1", "usage"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["context-docs", "agents", "ag", "r1"] });
  });

  it("AC-CTX-126 detach success invalidates the usage key", async () => {
    del.mockResolvedValue({ ok: true });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDetachContextDoc("skills", "sk", "r1"), { wrapper });
    act(() => result.current.mutate("doc-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: contextUsageKey("r1") });
  });

  it("AC-CTX-125 usage query does not retry", async () => {
    get.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useContextUsage("r1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/repos/r1/context/usage");
  });
});
