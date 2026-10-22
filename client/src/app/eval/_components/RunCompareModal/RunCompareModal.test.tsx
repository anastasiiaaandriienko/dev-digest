/**
 * Compare two runs (L06, spec §12.4; AC-EVAL-25..27): metrics old → new with
 * N/A-safe deltas, the different-case-set warning, same-prompt / config notes,
 * config + skill changes, the prompt diff and per-case changes; API errors.
 * useEvalCompare is mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalRun, EvalRunComparison } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../messages/en/eval.json";

let compareQ: { data?: EvalRunComparison; isLoading: boolean; isError: boolean; error?: unknown; refetch: () => void };
vi.mock("@/lib/hooks/evals", () => ({ useEvalCompare: () => compareQ }));

import { RunCompareModal } from "./RunCompareModal";

const C = messages.compare;
const run = (o: Partial<AgentEvalRun>): AgentEvalRun => ({
  id: "r",
  agent_id: "a",
  agent_version: 1,
  prompt_sha: "p",
  status: "done",
  error: null,
  started_at: "t",
  finished_at: "t",
  recall: 0.5,
  precision: 0.5,
  citation_accuracy: 0.8,
  counts: null,
  cost_usd: 0.002,
  duration_ms: 1,
  ...o,
});
const summary = (o: Partial<NonNullable<EvalRunComparison["config"]["base"]>> = {}) => ({
  provider: "openrouter" as const,
  model: "m1",
  strategy: "single-pass" as const,
  agent_version: 1,
  prompt_sha: "aaaaaaaaaaaaaaaaaaaa",
  skills: [],
  ...o,
});
const CMP: EvalRunComparison = {
  base: run({ id: "b", agent_version: 1, recall: 0.5, precision: 0.5 }),
  head: run({ id: "h", agent_version: 2, recall: 1, precision: null, cost_usd: null }),
  base_prompt: "Return at most 5 findings.",
  head_prompt: "Return at most 5 findings. Flag unused imports.",
  config: {
    base: summary(),
    head: summary({ model: "m2", agent_version: 2, prompt_sha: "bbbbbbbbbbbbbbbbbbbb", skills: [{ id: "s1", name: "rules", version: 2, body_sha: "x" }] }),
  },
  skill_changes: [{ id: "s1", name: "rules", change: "added", base_version: null, head_version: 2 }],
  delta: { recall: 0.5, precision: null, citation_accuracy: 0, cost_usd: null },
  prompt_changed: true,
  config_changes: ["model", "skills"],
  same_case_set: false,
  cases: [
    { case_id: "c1", case_name: "must-find-a", kind: "must_find", base: "fn", head: "tp", change: "fixed" },
    { case_id: "c2", case_name: "no-b", kind: "must_not_flag", base: "pass", head: "fail", change: "regressed" },
    { case_id: "c3", case_name: "new-c", kind: "must_find", base: null, head: "tp", change: "only_head" },
  ],
};

afterEach(cleanup);

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <RunCompareModal baseId="b" headId="h" baseVersion={1} headVersion={2} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunCompareModal", () => {
  it("shows metrics old → new with deltas, and N/A (no delta) for undefined values", () => {
    compareQ = { data: CMP, isLoading: false, isError: false, refetch: vi.fn() };
    renderModal();
    expect(screen.getByText("Compare runs · v1 → v2")).toBeTruthy();
    expect(screen.getByTestId("compare-metric-recall")).toHaveTextContent("50%100%▲ 50pt");
    expect(screen.getByTestId("compare-metric-precision")).toHaveTextContent("50%N/A");
    expect(screen.getByTestId("compare-metric-precision")).not.toHaveTextContent("pt");
    expect(screen.getByTestId("compare-metric-citation")).toHaveTextContent("80%80%");
    expect(screen.getByTestId("compare-metric-cost")).toHaveTextContent("$0.0020N/A");
  });

  it("warns about a different case set and lists config + skill changes", () => {
    compareQ = { data: CMP, isLoading: false, isError: false, refetch: vi.fn() };
    renderModal();
    expect(screen.getByTestId("compare-different-cases")).toHaveTextContent(C.differentCases);
    expect(screen.queryByTestId("compare-same-prompt")).toBeNull();
    expect(screen.getByTestId("compare-config-changes")).toHaveTextContent("Config changed: model, skills");
    const config = screen.getByTestId("compare-config");
    expect(config).toHaveTextContent("m1");
    expect(config).toHaveTextContent("m2");
    expect(config).toHaveTextContent("bbbbbbbbbbbb…");
    expect(screen.getByTestId("compare-skill-changes")).toHaveTextContent("rules — added");
  });

  it("renders the prompt diff and per-case changes", () => {
    compareQ = { data: CMP, isLoading: false, isError: false, refetch: vi.fn() };
    renderModal();
    const added = [...screen.getByTestId("compare-prompt-diff").querySelectorAll('[data-k="add"]')].map((e) => e.textContent).join("");
    expect(added).toContain("Flag");
    expect(added).toContain("imports.");
    const rows = screen.getAllByTestId("compare-case");
    expect(rows.map((r) => r.getAttribute("data-change"))).toEqual(["fixed", "regressed", "only_head"]);
    expect(rows[0]).toHaveTextContent("missed → found");
    expect(within(rows[2]!).getByText(C.change.only_head)).toBeTruthy();
    expect(rows[2]).toHaveTextContent("— → found");
  });

  it("notes when both runs used the same prompt and the case sets match", () => {
    compareQ = {
      data: { ...CMP, prompt_changed: false, same_case_set: true, config_changes: [], skill_changes: [], head_prompt: CMP.base_prompt },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderModal();
    expect(screen.getByTestId("compare-same-prompt")).toHaveTextContent(C.samePrompt);
    expect(screen.queryByTestId("compare-different-cases")).toBeNull();
    expect(screen.queryByTestId("compare-config-changes")).toBeNull();
  });

  it.each([
    ["run_not_done", 409],
    ["different_agents", 422],
  ] as const)("explains a %s error", (code, status) => {
    compareQ = { isLoading: false, isError: true, error: new ApiError("x", status, code), refetch: vi.fn() };
    renderModal();
    expect(screen.getByText(C.loadError)).toBeTruthy();
    expect(screen.getByText(C.errors[code])).toBeTruthy();
  });
});
