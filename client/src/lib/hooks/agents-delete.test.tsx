/** useDeleteAgent (HW2 #34) against a real QueryClient with the HTTP layer mocked. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const del = vi.fn();
vi.mock("../api", () => ({ api: { del: (...a: unknown[]) => del(...a) }, API_BASE: "" }));

import { useDeleteAgent } from "./agents";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  del.mockReset();
});

describe("useDeleteAgent", () => {
  it("DELETEs the agent, drops its cached page and refreshes the list", async () => {
    del.mockResolvedValue({ ok: true });
    qc.setQueryData(["agent", "ag1"], { id: "ag1" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    await act(() => result.current.mutateAsync("ag1"));
    expect(del).toHaveBeenCalledWith("/agents/ag1");
    expect(qc.getQueryData(["agent", "ag1"])).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
  });

  it("a failed delete (e.g. 404: already gone) still refreshes the list and keeps the cached page", async () => {
    del.mockRejectedValue(new Error("Agent not found"));
    qc.setQueryData(["agent", "ag1"], { id: "ag1" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteAgent(), { wrapper });
    await act(() => result.current.mutateAsync("ag1").catch(() => undefined));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(qc.getQueryData(["agent", "ag1"])).toEqual({ id: "ag1" });
  });
});
