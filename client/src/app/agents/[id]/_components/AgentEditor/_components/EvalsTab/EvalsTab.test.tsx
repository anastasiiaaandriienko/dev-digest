/**
 * AgentEditor → Evals (L06, spec §12.2; AC-EVAL-29, -32): read-only on open,
 * metrics with N/A for undefined values, cases with kind / location / latest
 * result, run history with statuses and cost, and a paid-call confirmation
 * before any run starts. Hooks and toasts are mocked — no network.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentEvalCase, AgentEvalRun } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/eval.json";

type Q<T> = { data?: T; isLoading: boolean; isError: boolean; error?: Error; refetch: () => Promise<unknown> };
let casesQ: Q<AgentEvalCase[]>;
let runsQ: Q<AgentEvalRun[]>;
const startAsync = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => casesQ,
  useAgentEvalRuns: () => runsQ,
  useStartEvalRun: () => ({ mutateAsync: startAsync, isPending: false }),
}));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { EvalsTab } from "./EvalsTab";

const T = messages.evalsTab;
const AGENT = { id: "ag1", name: "Test Reviewer", version: 3 } as Agent;

function evalCase(id: string, o: Partial<AgentEvalCase> = {}): AgentEvalCase {
  return {
    id,
    agent_id: "ag1",
    name: `case-${id}`,
    kind: "must_find",
    notes: null,
    expected: { kind: "must_find", file: "src/a.ts", start_line: 5, end_line: 6, severity: "WARNING", category: "bug", title: "t" },
    meta: {} as AgentEvalCase["meta"],
    input_hash: `h-${id}`,
    created_at: "2026-10-22T10:00:00.000Z",
    source_finding_id: "f",
    last_result: null,
    ...o,
  };
}
function evalRun(id: string, status: AgentEvalRun["status"], o: Partial<AgentEvalRun> = {}): AgentEvalRun {
  return {
    id,
    agent_id: "ag1",
    agent_version: 2,
    prompt_sha: "p",
    status,
    error: null,
    started_at: "2026-10-22T10:00:00.000Z",
    finished_at: null,
    recall: null,
    precision: null,
    citation_accuracy: null,
    counts: null,
    cost_usd: null,
    duration_ms: null,
    ...o,
  };
}
const counts = (o: Partial<NonNullable<AgentEvalRun["counts"]>> = {}) => ({
  cases_total: 3,
  cases_passed: 2,
  tp: 1,
  fn: 1,
  fp: 2,
  fp_by_reason: { too_wide: 0, duplicate: 1, negative_hit: 1, unlabeled: 0 },
  kept: 3,
  raw: 4,
  valid_citations: 3,
  tokens_in: 1,
  tokens_out: 1,
  ...o,
});
const q = <T,>(data: T | undefined, o: Partial<Q<T>> = {}): Q<T> => ({ data, isLoading: false, isError: false, refetch: vi.fn(async () => undefined), ...o });

beforeEach(() => {
  casesQ = q([
    evalCase("c1", { last_result: { suite_run_id: "r2", outcome: "tp", ran_at: "t" } }),
    evalCase("c2", {
      kind: "must_not_flag",
      input_hash: "h-c1",
      expected: { kind: "must_not_flag", file: "src/b.ts", start_line: 9, end_line: 9, severity: "SUGGESTION", category: "style", title: "t" },
      last_result: { suite_run_id: "r2", outcome: "fail", ran_at: "t" },
    }),
    evalCase("c3"),
  ]);
  runsQ = q([
    evalRun("r2", "done", { recall: 0.5, precision: null, citation_accuracy: 0.75, counts: counts(), cost_usd: 0.0021, agent_version: 3 }),
    evalRun("r1", "done", { recall: 0.25, precision: 0.4, citation_accuracy: 0.8, counts: counts(), cost_usd: 0.3 }),
  ]);
});
afterEach(() => {
  cleanup();
  startAsync.mockReset();
  success.mockReset();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}
const runButton = () => screen.getByRole("button", { name: T.runEvals }) as HTMLButtonElement;

describe("EvalsTab — data", () => {
  it("never starts a run on open", () => {
    renderTab();
    expect(startAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId("run-evals-confirm")).toBeNull();
  });

  it("shows the latest finished run's metrics, N/A for undefined ones, deltas and the FP breakdown", () => {
    renderTab();
    expect(screen.getByTestId("eval-metric-recall")).toHaveTextContent("50%");
    expect(screen.getByTestId("eval-metric-recall")).toHaveTextContent("▲ 25pt");
    // precision is undefined on the latest run: N/A and no delta (never 0 % / 100 %)
    expect(screen.getByTestId("eval-metric-precision")).toHaveTextContent("N/A");
    expect(screen.getByTestId("eval-metric-precision")).not.toHaveTextContent("pt");
    expect(screen.getByTestId("eval-metric-citation")).toHaveTextContent("75%");
    expect(screen.getByTestId("eval-metric-citation")).toHaveTextContent("▼ 5pt");
    expect(screen.getByTestId("eval-metric-cases")).toHaveTextContent("2/3");
    expect(screen.getByTestId("eval-fp-breakdown")).toHaveTextContent("FP: 0 unlabeled · 1 dismissed location · 1 duplicate · 0 too wide");
  });

  it("lists cases with kind, expected location, latest result and expectation", () => {
    renderTab();
    const rows = screen.getAllByTestId("eval-case-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("case-c1")).toBeTruthy();
    expect(rows[0]).toHaveTextContent(T.kind.must_find);
    expect(rows[0]).toHaveTextContent("src/a.ts:5-6");
    expect(within(rows[0]!).getByTestId("eval-case-outcome")).toHaveTextContent(T.outcome.tp);
    expect(rows[0]).toHaveTextContent("WARNING · bug");
    expect(rows[1]).toHaveTextContent(T.kind.must_not_flag);
    expect(within(rows[1]!).getByTestId("eval-case-outcome")).toHaveTextContent(T.outcome.fail);
    expect(rows[1]).toHaveTextContent(T.expectedEmpty);
    expect(rows[2]).toHaveAttribute("data-status", "never");
    expect(within(rows[2]!).getByTestId("eval-case-outcome")).toHaveTextContent(T.outcome.never);
    expect(screen.getByText("1 / 2 passing")).toBeTruthy();
    expect(screen.getByText("3 cases")).toBeTruthy();
  });

  it("shows the run history with status, N/A metrics, cost and a details link; dashboard link", () => {
    runsQ = q([
      evalRun("r3", "failed", { error: "provider 503" }),
      evalRun("r2", "done", { recall: 1, precision: 0.5, citation_accuracy: null, cost_usd: 0.0021, counts: counts() }),
    ]);
    renderTab();
    const rows = screen.getAllByTestId("eval-run-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["failed", "done"]);
    expect(rows[0]).toHaveTextContent("R N/A · P N/A · C N/A");
    expect(rows[0]).toHaveTextContent("N/A"); // unknown cost
    expect(rows[1]).toHaveTextContent("R 100% · P 50% · C N/A");
    expect(rows[1]).toHaveTextContent("$0.0021");
    expect(within(rows[1]!).getByRole("link", { name: T.history.details })).toHaveAttribute("href", "/eval?agent=ag1&run=r2");
    expect(screen.getByRole("link", { name: T.viewDashboard })).toHaveAttribute("href", "/eval?agent=ag1");
    expect(screen.getByTestId("eval-failed-banner")).toHaveTextContent("The last eval run failed: provider 503");
  });

  it("shows a running banner and disables Run evals while a run is in progress", () => {
    runsQ = q([evalRun("r3", "running"), ...runsQ.data!]);
    renderTab();
    expect(screen.getByTestId("eval-running-banner")).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(runButton()).toHaveAttribute("title", T.runDisabledRunning);
  });

  it("without a finished run shows no metric tiles (no fake 0 %)", () => {
    runsQ = q([evalRun("r1", "failed", { error: "x" })]);
    renderTab();
    expect(screen.getByTestId("eval-no-finished-run")).toHaveTextContent(T.noFinishedRun);
    expect(screen.queryByTestId("eval-metric-recall")).toBeNull();
  });
});

describe("EvalsTab — loading, empty, errors", () => {
  it("renders loading states without starting anything", () => {
    casesQ = q<AgentEvalCase[]>(undefined, { isLoading: true });
    runsQ = q<AgentEvalRun[]>(undefined, { isLoading: true });
    renderTab();
    expect(screen.queryByTestId("eval-case-list")).toBeNull();
    expect(runButton().disabled).toBe(true);
  });

  it("shows retryable errors for cases and runs", () => {
    casesQ = q<AgentEvalCase[]>(undefined, { isError: true, error: new Error("cases down") });
    runsQ = q<AgentEvalRun[]>(undefined, { isError: true, error: new Error("runs down") });
    renderTab();
    expect(screen.getByText(T.loadCasesError)).toBeTruthy();
    expect(screen.getByText(T.loadRunsError)).toBeTruthy();
    for (const b of screen.getAllByRole("button", { name: /retry/i })) fireEvent.click(b);
    expect(casesQ.refetch).toHaveBeenCalled();
    expect(runsQ.refetch).toHaveBeenCalled();
  });

  it("explains how to get cases and disables Run evals when there are none", () => {
    casesQ = q([]);
    runsQ = q([]);
    renderTab();
    expect(screen.getByText(T.emptyCases)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
    expect(runButton()).toHaveAttribute("title", T.runDisabledNoCases);
    expect(screen.getByText(T.history.empty)).toBeTruthy();
  });
});

describe("EvalsTab — paid-call confirmation", () => {
  it("asks first: agent version, cases, distinct inputs, paid warning; Cancel starts nothing", () => {
    renderTab();
    fireEvent.click(runButton());
    const dialog = screen.getByTestId("run-evals-confirm");
    expect(dialog).toHaveTextContent("Runs Test Reviewer v3 on 3 eval cases (2 distinct inputs).");
    expect(within(dialog).getByRole("note")).toHaveTextContent(T.confirm.paid);
    fireEvent.click(screen.getByRole("button", { name: T.confirm.cancel }));
    expect(screen.queryByTestId("run-evals-confirm")).toBeNull();
    expect(startAsync).not.toHaveBeenCalled();
  });

  it("starts exactly one run after confirming, toasts and closes", async () => {
    startAsync.mockResolvedValue({ id: "r9", status: "running" });
    renderTab();
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("button", { name: T.confirm.start }));
    await waitFor(() => expect(screen.queryByTestId("run-evals-confirm")).toBeNull());
    expect(startAsync).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(T.started);
  });

  it.each([
    ["eval_run_in_progress", 409],
    ["too_many_cases", 422],
    ["config_error", 500],
  ] as const)("keeps the dialog open with a message on %s", async (code, status) => {
    startAsync.mockRejectedValue(new ApiError("server", status, code));
    renderTab();
    fireEvent.click(runButton());
    fireEvent.click(screen.getByRole("button", { name: T.confirm.start }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(T.startErrors[code]));
    expect(screen.getByTestId("run-evals-confirm")).toBeTruthy();
  });
});
