/** Brief hooks — the mutation re-reads the brief on both success and failure. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const post = vi.fn();
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, post: (p: string, b: unknown) => post(p, b) } };
});

import { ApiError } from "../api";
import { briefKey, useRunBrief } from "./brief";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { spy, wrapper };
}

beforeEach(() => {
  post.mockReset();
  // TanStack logs the failed mutation via console.error; keep the output clean.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("useRunBrief", () => {
  it("AC-BRIEF-39 invalidates brief key on success", async () => {
    post.mockResolvedValue({ pr_id: "pr1" });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRunBrief("pr1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ force: false });
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: briefKey("pr1") }));
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief", { force: false });
  });

  it("AC-BRIEF-39 invalidates brief key on error", async () => {
    post.mockRejectedValue(new ApiError("boom", 504, "brief_timeout"));
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRunBrief("pr1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ force: true }).catch(() => undefined);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: briefKey("pr1") }));
    expect(post).toHaveBeenCalledTimes(1);
  });
});
