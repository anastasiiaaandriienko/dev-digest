/**
 * PR Brief card — states, explicit-click-only POST, model_error, stale, failures,
 * focus navigation, i18n and the "never render tokens/cost" rule. Hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, PrBriefState } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/brief.json";
import { ApiError } from "@/lib/api";

let query: { data?: PrBriefState; isLoading: boolean; isError: boolean };
let mutation: { isPending: boolean; isError: boolean; error: unknown };
const refetch = vi.fn();
const mutate = vi.fn();
const push = vi.fn();
let settled = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/repos/r1/pulls/482",
}));
vi.mock("@/lib/hooks/intent", async (orig) => {
  const actual = await orig<typeof import("@/lib/hooks/intent")>();
  return { ...actual, usePullSettled: () => settled };
});
vi.mock("@/lib/hooks/brief", async (orig) => {
  const actual = await orig<typeof import("@/lib/hooks/brief")>();
  return {
    ...actual,
    usePrBrief: () => ({ ...query, refetch }),
    useRunBrief: () => ({ ...mutation, mutate }),
  };
});

import { BriefCard } from "./BriefCard";

const BRIEF: PrBrief = {
  intent: { intent: "", in_scope: [], out_of_scope: [] },
  blast: { changed_symbols: [], downstream: [], summary: "", degraded: true, reason: "no_data" } as unknown as PrBrief["blast"],
  risks: {
    risks: [
      {
        kind: "security",
        title: "Rate limit bypass",
        explanation: "The limiter is skipped for internal hosts.",
        severity: "high",
        file_refs: ["src/middleware/ratelimit.ts:12"],
      },
    ],
  },
  summary: "Adds a per-IP rate limiter to the API.",
  review_focus: [
    { path: "src/middleware/ratelimit.ts", line: 12, reason: "window math" },
    { path: "src/config.ts", line: 12, reason: "new env var" },
  ],
  meta: {
    head_sha: "abcdef1234567890",
    provider: "openrouter",
    model: "google/gemini-flash",
    prompt_version: "brief-v1",
    tokens_in: 7777,
    tokens_out: 4242,
    attempts: 3,
    cost_usd: 0.0987,
    generated_at: "2026-10-18T10:00:00.000Z",
    truncated: false,
    intent_available: false,
  },
};

function state(over: Partial<PrBriefState> = {}): PrBriefState {
  return { pr_id: "pr1", brief: null, freshness: "unknown", stale_reasons: [], ...over };
}
const withBrief = (over: Partial<PrBriefState> = {}) => state({ brief: BRIEF, freshness: "fresh", ...over });

beforeEach(() => {
  query = { data: state(), isLoading: false, isError: false };
  mutation = { isPending: false, isError: false, error: null };
  settled = true;
});
afterEach(() => {
  cleanup();
  refetch.mockReset();
  mutate.mockReset();
  push.mockReset();
});

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <BriefCard prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BriefCard", () => {
  it("AC-BRIEF-31 Generate sends one POST per click and shows loading", () => {
    renderCard();
    expect(mutate).not.toHaveBeenCalled(); // never on mount
    const btn = screen.getByRole("button", { name: messages.card.generate });
    fireEvent.click(btn);
    fireEvent.click(btn); // double click
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ force: false });

    cleanup();
    mutation.isPending = true;
    renderCard();
    expect(screen.getByRole("button", { name: messages.card.generating })).toBeDisabled();
  });

  it("AC-BRIEF-32 renders summary, risks and Review focus (n) as path:line — reason", () => {
    query.data = withBrief();
    renderCard();
    expect(screen.getByText(messages.card.title)).toBeInTheDocument();
    expect(screen.getByText("Adds a per-IP rate limiter to the API.")).toBeInTheDocument();
    expect(screen.getByText("Rate limit bypass")).toBeInTheDocument();
    expect(screen.getByText("The limiter is skipped for internal hosts.")).toBeInTheDocument();
    expect(screen.getByText("Review focus (2)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.includes(" — "));
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("src/middleware/ratelimit.ts:12 — window math");
    expect(items[1]).toHaveTextContent("src/config.ts:12 — new env var");
  });

  it("AC-BRIEF-32 model_error keeps brief and focus visible, disables Generate/Refresh", () => {
    query.data = withBrief({ model_error: "No API key for openai" });
    renderCard();
    expect(screen.getByText("Adds a per-IP rate limiter to the API.")).toBeInTheDocument();
    expect(screen.getByText("Review focus (2)")).toBeInTheDocument();
    expect(screen.getByText("No API key for openai")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: messages.card.refresh });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mutate).not.toHaveBeenCalled();

    cleanup();
    query.data = state({ model_error: "No API key for openai" });
    renderCard();
    expect(screen.getByRole("button", { name: messages.card.generate })).toBeDisabled();
    expect(screen.getByText("No API key for openai")).toBeInTheDocument();
  });

  it("AC-BRIEF-33 stale shows indicator and Refresh sends force:true", () => {
    query.data = withBrief({ freshness: "stale", stale_reasons: ["pr_changed", "model_changed"] });
    renderCard();
    expect(screen.getByText(messages.card.stale)).toBeInTheDocument();
    expect(screen.getByText(messages.card.staleReasons.pr_changed)).toBeInTheDocument();
    expect(screen.getByText(messages.card.staleReasons.model_changed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: messages.card.refresh }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ force: true });
  });

  it("AC-BRIEF-34 POST failure shows API message and keeps previous brief", () => {
    query.data = withBrief();
    mutation = { isPending: false, isError: true, error: new ApiError("Brief timed out. Try again.", 504, "brief_timeout") };
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent("Brief timed out. Try again.");
    expect(screen.getByText("Adds a per-IP rate limiter to the API.")).toBeInTheDocument();
    expect(screen.getByText("Review focus (2)")).toBeInTheDocument();

    cleanup();
    mutation = { isPending: false, isError: true, error: new Error("network") };
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.card.errors.fallback);
  });

  it("AC-BRIEF-35 focus click navigates to ?tab=diff&file&line", () => {
    query.data = withBrief();
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "src/middleware/ratelimit.ts:12" }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0]![0] as string, "http://x");
    expect(url.pathname).toBe("/repos/r1/pulls/482");
    expect(url.searchParams.get("tab")).toBe("diff");
    expect(url.searchParams.get("file")).toBe("src/middleware/ratelimit.ts");
    expect(url.searchParams.get("line")).toBe("12");
  });

  it("AC-BRIEF-38 strings come from brief.json", () => {
    renderCard();
    expect(screen.getByText(messages.card.title)).toBeInTheDocument();
    expect(screen.getByText(messages.card.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.card.generate })).toBeInTheDocument();

    cleanup();
    query = { data: undefined, isLoading: true, isError: false };
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent(messages.card.loading);
  });

  it("AC-BRIEF-48 no tokens or cost rendered", () => {
    query.data = withBrief();
    renderCard();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/7777|4242|0\.0987|\$/);
    expect(text).not.toMatch(/tokens|attempts|cost/i);
  });
});
