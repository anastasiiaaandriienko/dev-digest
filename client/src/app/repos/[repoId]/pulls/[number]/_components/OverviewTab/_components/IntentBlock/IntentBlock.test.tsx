/**
 * L03 IntentBlock — states, explicit-click-only POST, error messages, and
 * plain-text rendering of untrusted LLM output. Intent hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentState } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/intent.json";
import { ApiError } from "@/lib/api";

let query: { data?: PrIntentState; isLoading: boolean; isError: boolean };
let mutation: { isPending: boolean; isError: boolean; error: unknown };
const refetch = vi.fn();
const mutate = vi.fn();
const reset = vi.fn();
let enabledArg: boolean | undefined;
let settled = true;

vi.mock("@/lib/hooks/intent", async (orig) => {
  const actual = await orig<typeof import("@/lib/hooks/intent")>();
  return {
    ...actual,
    usePullSettled: () => settled, // detail/intent sync is covered in IntentBlock.sync.test.tsx
    usePrIntent: (_id: string | null, enabled?: boolean) => {
      enabledArg = enabled;
      return { ...query, refetch };
    },
    useRunIntent: () => ({ ...mutation, mutate, reset }),
  };
});

import { IntentBlock } from "./IntentBlock";

function state(over: Partial<PrIntentState> = {}): PrIntentState {
  return {
    pr_id: "pr1",
    intent: null,
    meta: null,
    freshness: "unknown",
    stale_reasons: [],
    current_model: { provider: "openrouter", model: "google/gemini-flash", source: "override" },
    ...over,
  };
}
const withIntent = (over: Partial<PrIntentState> = {}) =>
  state({
    intent: {
      intent: "Adds retry to the sync job",
      in_scope: ["retry logic"],
      out_of_scope: ["UI changes"],
      risk_areas: ["race conditions"],
    },
    meta: {
      provider: "openrouter",
      model: "google/gemini-flash",
      prompt_version: "v2",
      confidence: "high",
      generated_at: "2026-10-16T10:00:00Z",
      head_sha: "abcdef1234567890",
      input_snapshot_at: null,
      tokens_in: 10,
      tokens_out: 5,
      cost_usd: 0.0123,
    },
    freshness: "fresh",
    ...over,
  });

beforeEach(() => {
  query = { data: state(), isLoading: false, isError: false };
  mutation = { isPending: false, isError: false, error: null };
  settled = true;
});
afterEach(() => {
  cleanup();
  refetch.mockReset();
  mutate.mockReset();
  reset.mockReset();
});

function renderBlock() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
        <IntentBlock prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentBlock", () => {
  it("empty state previews the model and cost notice; never POSTs on render; Run sends force:false once", () => {
    renderBlock();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.getByText(/Will use: openrouter\/google\/gemini-flash \(from Settings\)/)).toBeInTheDocument();
    expect(screen.getByText(messages.costNotice)).toBeInTheDocument();

    const btn = screen.getByRole("button", { name: messages.runIntent });
    fireEvent.click(btn);
    fireEvent.click(btn); // double click
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ force: false });
  });

  it("shows the fallback source label", () => {
    query.data = state({ current_model: { provider: "openrouter", model: "m", source: "fallback_onboarding" } });
    renderBlock();
    expect(screen.getByText(/fallback from Onboarding/)).toBeInTheDocument();
  });

  it("model_error disables Run and points to Settings", () => {
    query.data = state({ current_model: null, model_error: "No API key for openai" });
    renderBlock();
    expect(screen.getByText("No API key for openai")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.settingsLink })).toHaveAttribute("href", "/settings/models");
    expect(screen.getByRole("button", { name: messages.runIntent })).toBeDisabled();
  });

  it("loading state; and the read waits for the PR detail (enabled arg true when idle)", () => {
    query = { data: undefined, isLoading: true, isError: false };
    renderBlock();
    expect(screen.getByRole("status")).toHaveTextContent(messages.loading);
    expect(enabledArg).toBe(true);
  });

  it("running state disables the button", () => {
    mutation.isPending = true;
    renderBlock();
    expect(screen.getByRole("button", { name: messages.running })).toBeDisabled();
  });

  it("success: summary, scopes, risks, meta; Recalculate sends force:true", () => {
    query.data = withIntent();
    renderBlock();
    expect(screen.getByText("Adds retry to the sync job")).toBeInTheDocument();
    expect(screen.getByText("retry logic")).toBeInTheDocument();
    expect(screen.getByText("UI changes")).toBeInTheDocument();
    expect(screen.getByText("race conditions")).toBeInTheDocument();
    expect(screen.getByText(messages.freshness.fresh)).toBeInTheDocument();
    expect(screen.getByText(/Generated with: openrouter\/google\/gemini-flash/)).toBeInTheDocument();
    expect(screen.getByText(/Cost: \$0\.0123/)).toBeInTheDocument();
    expect(screen.getByText(/^Generated (?!with)/)).toBeInTheDocument();
    expect(screen.getByText(/computed for head abcdef1/)).toBeInTheDocument();
    expect(screen.getByText(messages.costNotice)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: messages.recalculate }));
    expect(mutate.mock.calls[0]![0]).toEqual({ force: true });
  });

  it("with an intent shows the stored model and the (different) Recalculate model separately", () => {
    query.data = withIntent({
      current_model: { provider: "anthropic", model: "claude-x", source: "fallback_onboarding" },
    });
    renderBlock();
    expect(screen.getByText("Generated with: openrouter/google/gemini-flash")).toBeInTheDocument();
    expect(
      screen.getByText("Recalculate will use: anthropic/claude-x (fallback from Onboarding)"),
    ).toBeInTheDocument();
    expect(screen.getByText(messages.costNotice)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.recalculate })).toBeEnabled();
  });

  it("with an intent but no current model: reason, Settings link, Recalculate disabled with explanation", () => {
    query.data = withIntent({ current_model: null, model_error: "No API key for openai" });
    renderBlock();
    expect(screen.getByText("Generated with: openrouter/google/gemini-flash")).toBeInTheDocument();
    expect(screen.getByText("No API key for openai")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.settingsLink })).toHaveAttribute("href", "/settings/models");
    expect(screen.getByText(messages.recalcUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.recalculate })).toBeDisabled();
    expect(screen.queryByText(/Recalculate will use/)).toBeNull();
  });

  it("empty model name (provider set) is unavailable: reason shown, Run and Recalculate disabled", () => {
    query.data = state({ current_model: { provider: "openrouter", model: "", source: "override" }, model_error: "Model missing" });
    renderBlock();
    expect(screen.getByText("Model missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.runIntent })).toBeDisabled();
    cleanup();

    query.data = withIntent({ current_model: { provider: "openrouter", model: "", source: "override" }, model_error: "Model missing" });
    renderBlock();
    expect(screen.getByText(messages.recalcUnavailable)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.recalculate })).toBeDisabled();
  });

  it("while the PR detail is not settled, Run and Recalculate are disabled, hint shown, no mutate", () => {
    settled = false;
    renderBlock();
    const run = screen.getByRole("button", { name: messages.runIntent });
    expect(run).toBeDisabled();
    expect(screen.getByText(messages.waitingForPr)).toBeInTheDocument();
    fireEvent.click(run);
    expect(mutate).not.toHaveBeenCalled();
    cleanup();

    query.data = withIntent();
    renderBlock();
    const recalc = screen.getByRole("button", { name: messages.recalculate });
    expect(recalc).toBeDisabled();
    fireEvent.click(recalc);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("legacy row hides generated time; no risk section when empty; unknown cost is a dash", () => {
    const d = withIntent();
    d.meta!.prompt_version = null;
    d.meta!.cost_usd = null;
    d.intent!.risk_areas = [];
    query.data = d;
    renderBlock();
    expect(screen.queryByText(/^Generated (?!with)/)).toBeNull();
    expect(screen.queryByText(messages.riskAreas)).toBeNull();
    expect(screen.getByText(/Cost: —/)).toBeInTheDocument();
  });

  it("stale shows human-readable reasons; unknown shows the not-synced message", () => {
    query.data = withIntent({ freshness: "stale", stale_reasons: ["pr_changed", "model_changed"] });
    renderBlock();
    expect(screen.getByText(messages.freshness.stale)).toBeInTheDocument();
    expect(screen.getByText(messages.staleReasons.pr_changed)).toBeInTheDocument();
    expect(screen.getByText(messages.staleReasons.model_changed)).toBeInTheDocument();
    cleanup();

    query.data = withIntent({ freshness: "unknown" });
    renderBlock();
    expect(screen.getByText(messages.freshness.unknown)).toBeInTheDocument();
  });

  it.each([
    [409, "intent_inputs_incomplete", messages.errors.inputs_incomplete],
    [422, "intent_model_unavailable", messages.errors.model_unavailable],
    [429, undefined, messages.errors.rate_limited],
    [502, "external_service_error", messages.errors.provider_error],
    [500, "intent_save_failed", messages.errors.save_failed],
  ])("error %s shows our fixed message, not the server text", (status, code, text) => {
    mutation = { isPending: false, isError: true, error: new ApiError("<b>raw server text</b>", status, code) };
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.queryByText(/raw server text/)).toBeNull();
    expect(screen.queryByRole("button", { name: messages.refreshStatus })).toBeNull();
  });

  it("504 offers Refresh status that only refetches (no POST)", () => {
    mutation = { isPending: false, isError: true, error: new ApiError("t", 504, "intent_timeout") };
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.errors.timeout);
    fireEvent.click(screen.getByRole("button", { name: messages.refreshStatus }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("renders untrusted intent text literally (no img, no link, no markdown)", () => {
    query.data = withIntent({
      intent: {
        intent: "<img src=x onerror=alert(1)> **bold**",
        in_scope: ["[link](javascript:alert(1))"],
        out_of_scope: ["<a href='http://evil'>x</a>"],
        risk_areas: ["<script>alert(1)</script>"],
      },
    });
    renderBlock();
    expect(screen.getByText("<img src=x onerror=alert(1)> **bold**")).toBeInTheDocument();
    expect(screen.getByText("[link](javascript:alert(1))")).toBeInTheDocument();
    expect(screen.getByText("<a href='http://evil'>x</a>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("strong")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
