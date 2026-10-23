/**
 * Eval run detail (`/eval?agent=…&run=…`, spec §12.3; AC-EVAL-23, -32): status +
 * error, metrics with N/A, TP / FN / FP and FP reasons, the de-duplicated FP list,
 * per-case results (matched / overlapping / engine error) and the config snapshot.
 * useEvalRun is mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentEvalRunDetail, EvalCaseRunResult, Finding } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

let runQ: { data?: AgentEvalRunDetail; isLoading: boolean; isError: boolean; error?: Error; refetch: () => void };
vi.mock("@/lib/hooks/evals", () => ({ useEvalRun: () => runQ }));

import { RunDetailDrawer } from "./RunDetailDrawer";

const R = messages.runDetail;
const finding = (id: string, line: number): Finding => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: `F ${id}`,
  file: "src/a.ts",
  start_line: line,
  end_line: line,
  rationale: "r",
  confidence: 1,
});
const fps = [
  { finding: finding("dup", 5), reason: "duplicate" as const },
  { finding: finding("neg", 20), reason: "negative_hit" as const },
];
const result = (o: Partial<EvalCaseRunResult>): EvalCaseRunResult => ({
  case_id: "c",
  case_name: "c",
  kind: "must_find",
  outcome: "tp",
  pass: true,
  expected: { kind: "must_find", file: "src/a.ts", start_line: 5, end_line: 5, severity: "WARNING", category: "bug", title: "t" },
  matched_finding: null,
  overlapping: [],
  group_fp: fps,
  dropped: [{ finding: finding("ghost", 400), reason: "no hunk" }],
  error: null,
  ...o,
});
const DETAIL: AgentEvalRunDetail = {
  id: "r1",
  agent_id: "a",
  agent_version: 3,
  prompt_sha: "p",
  status: "done",
  error: null,
  started_at: "2026-10-22T10:00:00.000Z",
  finished_at: "2026-10-22T10:00:04.000Z",
  recall: 0.5,
  precision: null,
  citation_accuracy: 0.75,
  counts: {
    cases_total: 3,
    cases_passed: 1,
    tp: 1,
    fn: 1,
    fp: 2,
    fp_by_reason: { too_wide: 0, duplicate: 1, negative_hit: 1, unlabeled: 0 },
    kept: 3,
    raw: 4,
    valid_citations: 3,
    tokens_in: 100,
    tokens_out: 40,
  },
  cost_usd: null,
  duration_ms: 4200,
  config: {
    provider: "openrouter",
    model: "deepseek/x",
    strategy: "single-pass",
    system_prompt: "You are the frozen reviewer.",
    agent_version: 3,
    skills: [{ id: "s1", name: "rules", version: 2, body: "B" }],
    excluded: ["repo_intel", "intent"],
  },
  results: [
    result({ case_id: "c1", case_name: "must-find-l5", matched_finding: finding("m", 5), overlapping: [finding("m", 5), finding("dup", 5)] }),
    result({ case_id: "c2", case_name: "must-find-l10", outcome: "fn", pass: false }),
    result({
      case_id: "c3",
      case_name: "no-l20",
      kind: "must_not_flag",
      outcome: "fail",
      pass: false,
      expected: { kind: "must_not_flag", file: "src/a.ts", start_line: 20, end_line: 20, severity: "SUGGESTION", category: "style", title: "t" },
      overlapping: [finding("neg", 20)],
    }),
  ],
};

afterEach(cleanup);

function renderDrawer() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <RunDetailDrawer runId="r1" onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunDetailDrawer", () => {
  it("shows metrics (N/A when undefined), TP / FN / FP, FP reasons, cost N/A and duration", () => {
    runQ = { data: DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
    renderDrawer();
    expect(screen.getByText("Eval run · v3")).toBeTruthy();
    expect(screen.getByTestId("run-detail-recall")).toHaveTextContent("50%");
    expect(screen.getByTestId("run-detail-precision")).toHaveTextContent("N/A");
    expect(screen.getByTestId("run-detail-citation")).toHaveTextContent("75%");
    const counts = screen.getByTestId("run-detail-counts");
    expect(counts).toHaveTextContent(`${R.tp}1`);
    expect(counts).toHaveTextContent(`${R.fn}1`);
    expect(counts).toHaveTextContent(`${R.fp}2`);
    expect(counts).toHaveTextContent(`${R.cost}N/A`);
    expect(counts).toHaveTextContent("4.2s");
    expect(screen.getByTestId("run-detail-fp-reasons")).toHaveTextContent("dismissed location 1");
    expect(screen.getByTestId("run-detail-fp-reasons")).toHaveTextContent("duplicate 1");
  });

  it("lists each false positive once and every case result", () => {
    runQ = { data: DETAIL, isLoading: false, isError: false, refetch: vi.fn() };
    renderDrawer();
    const fpList = screen.getByTestId("run-detail-fp-list");
    expect(fpList.children).toHaveLength(2); // repeated on 3 cases, shown once
    expect(fpList).toHaveTextContent("src/a.ts:20");
    expect(screen.getByText("1 finding dropped by the citation gate")).toBeTruthy();
    const cases = screen.getAllByTestId("run-detail-case");
    expect(cases.map((c) => c.getAttribute("data-outcome"))).toEqual(["tp", "fn", "fail"]);
    expect(cases[0]).toHaveTextContent("matched src/a.ts:5");
    expect(cases[2]).toHaveTextContent("1 finding on this location");
    expect(screen.getByTestId("run-detail-config")).toHaveTextContent("rules v2");
    expect(screen.getByText("You are the frozen reviewer.")).toBeTruthy();
  });

  it("shows a failed run's error and per-case engine errors", () => {
    runQ = {
      data: {
        ...DETAIL,
        status: "failed",
        error: "provider 503",
        recall: null,
        citation_accuracy: null,
        counts: null,
        results: [result({ case_id: "c1", case_name: "x", outcome: "error", pass: false, error: "provider 503", group_fp: [], dropped: [] })],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderDrawer();
    expect(screen.getByTestId("run-detail-error")).toHaveTextContent("Error: provider 503");
    expect(screen.getByTestId("run-detail-recall")).toHaveTextContent("N/A");
    expect(screen.getByTestId("run-detail-counts")).toHaveTextContent(`${R.tp}N/A`);
    expect(screen.getByTestId("run-detail-case")).toHaveTextContent("provider 503");
  });

  it("shows a retryable error when the run cannot be loaded", () => {
    const refetch = vi.fn();
    runQ = { isLoading: false, isError: true, error: new Error("404 Eval run not found"), refetch };
    renderDrawer();
    expect(screen.getByText(R.loadError)).toBeTruthy();
  });
});
