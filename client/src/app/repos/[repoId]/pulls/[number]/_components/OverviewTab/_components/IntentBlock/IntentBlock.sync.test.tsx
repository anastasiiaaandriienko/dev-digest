/**
 * L03 IntentBlock <-> PR detail sync. REAL QueryClient and REAL intent hooks;
 * only the HTTP layer (`api.get/post`) is mocked, with a controllable detail
 * request. Guards against reading intent during the server's pr_files resync.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentState } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/intent.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: (p: string) => get(p), post: (p: string, b: unknown) => post(p, b) } };
});

import { usePullDetail } from "@/lib/hooks/core";
import { IntentBlock } from "./IntentBlock";

const DETAIL = { id: "pr1" };
let detailResolvers: Array<() => void> = [];
let intentResponses: PrIntentState[] = [];

function intentState(freshness: PrIntentState["freshness"]): PrIntentState {
  return {
    pr_id: "pr1",
    intent: { intent: "Adds retry", in_scope: [], out_of_scope: [] },
    meta: null,
    freshness,
    stale_reasons: [],
    current_model: { provider: "p", model: "m", source: "override" },
  };
}

/** Mirrors the page: parent owns the detail query, IntentBlock is a child. */
function Page() {
  usePullDetail("pr1");
  return <IntentBlock prId="pr1" />;
}

const intentCalls = () => get.mock.calls.filter(([p]) => p === "/pulls/pr1/intent").length;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

function renderPage(qc: QueryClient) {
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
        <Page />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;
const noQueryFnErrors = () =>
  consoleError.mock.calls.filter((c: unknown[]) => c.some((a) => String(a).includes("No queryFn")));

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  detailResolvers = [];
  intentResponses = [];
  get.mockReset();
  post.mockReset();
  get.mockImplementation((path: string) => {
    if (path === "/pulls/pr1/intent") return Promise.resolve(intentResponses.shift());
    if (path === "/pulls/pr1") return new Promise((res) => detailResolvers.push(() => res(DETAIL)));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});
afterEach(() => {
  // The read-only intent observers must never log TanStack's "No queryFn" error on the page's keys.
  expect(noQueryFnErrors()).toEqual([]);
  consoleError.mockRestore();
  cleanup();
});

describe("IntentBlock with a real PR detail query", () => {
  it("stale cached detail on mount: no intent GET while the detail refetches, exactly one after; later refetch re-reads and updates the badge; never POSTs", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    // Stale cache => the page's observer refetches on mount (after the child's first render).
    qc.setQueryData(["pull", "pr1"], DETAIL, { updatedAt: Date.now() - 120_000 });
    intentResponses = [intentState("unknown"), intentState("fresh")];

    renderPage(qc);
    await flush();
    // (a) detail is fetching -> no intent GET
    expect(detailResolvers).toHaveLength(1);
    expect(intentCalls()).toBe(0);

    // (b) detail resolves -> exactly one intent GET
    await act(async () => detailResolvers.shift()!());
    await waitFor(() => expect(screen.getByText(messages.freshness.unknown)).toBeInTheDocument());
    await flush();
    expect(intentCalls()).toBe(1);

    // (c) a later detail refetch: no read mid-flight, re-read once it completes, badge updates
    let refetch!: Promise<unknown>;
    act(() => {
      refetch = qc.refetchQueries({ queryKey: ["pull", "pr1"] });
    });
    await flush();
    expect(detailResolvers).toHaveLength(1);
    expect(intentCalls()).toBe(1);
    await act(async () => detailResolvers.shift()!());
    await refetch;
    await waitFor(() => expect(screen.getByText(messages.freshness.fresh)).toBeInTheDocument());
    expect(intentCalls()).toBe(2);

    // (d) GET only
    expect(post).not.toHaveBeenCalled();
  });

  it("intent fresh in cache + stale detail: 0 intent GETs while detail fetches (actions disabled), exactly 1 after; no POST", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    qc.setQueryData(["pr-intent", "pr1"], intentState("fresh"), { updatedAt: Date.now() });
    qc.setQueryData(["pull", "pr1"], DETAIL, { updatedAt: Date.now() - 120_000 });
    intentResponses = [intentState("stale")];

    renderPage(qc);
    await flush();
    expect(detailResolvers).toHaveLength(1);
    expect(intentCalls()).toBe(0);
    const btn = screen.getByRole("button", { name: messages.recalculate });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(post).not.toHaveBeenCalled();

    await act(async () => detailResolvers.shift()!());
    await waitFor(() => expect(screen.getByText(messages.freshness.stale)).toBeInTheDocument());
    await flush();
    expect(intentCalls()).toBe(1);
    expect(screen.getByRole("button", { name: messages.recalculate })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it("fresh detail + no intent in cache: exactly one intent GET after mount (no double GET)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    qc.setQueryData(["pull", "pr1"], DETAIL, { updatedAt: Date.now() });
    intentResponses = [intentState("fresh")];

    renderPage(qc);
    await waitFor(() => expect(screen.getByText(messages.freshness.fresh)).toBeInTheDocument());
    await flush();
    expect(detailResolvers).toHaveLength(0);
    expect(intentCalls()).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });

  it("fresh detail + fresh intent in cache: zero intent GETs", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    qc.setQueryData(["pull", "pr1"], DETAIL, { updatedAt: Date.now() - 2_000 });
    qc.setQueryData(["pr-intent", "pr1"], intentState("fresh"), { updatedAt: Date.now() - 1_000 });

    renderPage(qc);
    await flush();
    await flush();
    expect(detailResolvers).toHaveLength(0);
    expect(intentCalls()).toBe(0);
    expect(screen.getByText(messages.freshness.fresh)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("cold cache: no intent GET until the first detail load completes", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    intentResponses = [intentState("fresh")];

    renderPage(qc);
    await flush();
    expect(intentCalls()).toBe(0);

    await act(async () => detailResolvers.shift()!());
    await waitFor(() => expect(screen.getByText(messages.freshness.fresh)).toBeInTheDocument());
    await flush();
    expect(intentCalls()).toBe(1);
    expect(post).not.toHaveBeenCalled();
  });
});
