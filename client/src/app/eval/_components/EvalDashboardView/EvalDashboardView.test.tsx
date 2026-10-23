/**
 * Eval Dashboard (/eval, L06 spec §12.3; AC-EVAL-31, -32): `?agent=` (default:
 * first agent) and `?run=` links, metric cards with N/A, the trend (N/A runs not
 * plotted as 0), precision-dip banner, run history with selection of two finished
 * runs → compare, the run detail, and Run evals behind the paid-call confirmation.
 * Hooks, routing and the app shell are mocked; the chart is stubbed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentEvalCase, AgentEvalRun, AgentEvalRunDetail, EvalRunComparison } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const replace = vi.fn();
let params = new URLSearchParams("agent=a1");
vi.mock("next/navigation", () => ({ useSearchParams: () => params, useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@devdigest/ui", async () => {
  const actual = await vi.importActual<typeof import("@devdigest/ui")>("@devdigest/ui");
  return {
    ...actual,
    LineChart: ({ series }: { series: { name: string; data: number[] }[] }) => (
      <div data-testid="line-chart" data-points={JSON.stringify(series.map((x) => x.data))} />
    ),
  };
});

type Q<T> = { data?: T; isLoading: boolean; isError: boolean; error?: Error; refetch: () => Promise<unknown> };
const q = <T,>(data: T | undefined, o: Partial<Q<T>> = {}): Q<T> => ({ data, isLoading: false, isError: false, refetch: vi.fn(async () => undefined), ...o });
let agentsQ: Q<Agent[]>;
let runsQ: Q<AgentEvalRun[]>;
let casesQ: Q<AgentEvalCase[]>;
const compareArgs: (string | null | undefined)[][] = [];
const startAsync = vi.fn();
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => agentsQ }));
vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalRuns: () => runsQ,
  useAgentEvalCases: () => casesQ,
  useStartEvalRun: () => ({ mutateAsync: startAsync, isPending: false }),
  useEvalRun: (id: string) => q<AgentEvalRunDetail>({ ...(runsQ.data!.find((r) => r.id === id) as AgentEvalRun), config: null, results: [] }),
  useEvalCompare: (base: string, head: string) => {
    compareArgs.push([base, head]);
    return q<EvalRunComparison>(undefined, { isLoading: true });
  },
}));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { EvalDashboardView } from "./EvalDashboardView";

const D = messages.dashboard;
const agent = (id: string, name: string) => ({ id, name, version: 4 }) as Agent;
const run = (id: string, status: AgentEvalRun["status"], o: Partial<AgentEvalRun> = {}): AgentEvalRun => ({
  id,
  agent_id: "a1",
  agent_version: 1,
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
});

beforeEach(() => {
  params = new URLSearchParams("agent=a1");
  agentsQ = q([agent("a1", "Test Reviewer"), agent("a2", "Security Reviewer")]);
  casesQ = q([{ id: "c1", input_hash: "h1" } as AgentEvalCase, { id: "c2", input_hash: "h1" } as AgentEvalCase]);
  runsQ = q([
    run("r4", "failed", { agent_version: 4, started_at: "2026-10-22T14:00:00.000Z", error: "boom" }),
    run("r3", "done", { agent_version: 3, recall: 1, precision: 0.5, citation_accuracy: null, started_at: "2026-10-22T13:00:00.000Z", cost_usd: 0.002 }),
    run("r2", "done", { agent_version: 2, recall: 0.5, precision: 0.75, citation_accuracy: 0.8, started_at: "2026-10-22T12:00:00.000Z" }),
    run("r1", "done", { agent_version: 1, recall: 0.25, precision: 0.5, citation_accuracy: 0.7, started_at: "2026-10-22T11:00:00.000Z" }),
  ]);
});
afterEach(() => {
  cleanup();
  replace.mockReset();
  startAsync.mockReset();
  compareArgs.length = 0;
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView — routing and states", () => {
  it("opens the first agent when ?agent= is missing", async () => {
    params = new URLSearchParams("");
    renderView();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/eval?agent=a1"));
  });

  it("switching the agent replaces ?agent= and drops ?run=", () => {
    params = new URLSearchParams("agent=a1&run=r2");
    renderView();
    fireEvent.change(screen.getByLabelText(D.agentLabel), { target: { value: "a2" } });
    expect(replace).toHaveBeenCalledWith("/eval?agent=a2");
  });

  it("explains an unknown agent, no agents and load errors", () => {
    params = new URLSearchParams("agent=nope");
    renderView();
    expect(screen.getByText(D.agentNotFound)).toBeTruthy();
    cleanup();
    agentsQ = q([]);
    renderView();
    expect(screen.getByText(D.noAgents)).toBeTruthy();
    cleanup();
    agentsQ = q<Agent[]>(undefined, { isError: true, error: new Error("down") });
    renderView();
    expect(screen.getByText(D.loadError)).toBeTruthy();
  });

  it("shows the empty state when the agent has no runs", () => {
    runsQ = q([]);
    renderView();
    expect(screen.getByText(D.noRuns)).toBeTruthy();
  });
});

describe("EvalDashboardView — metrics and history", () => {
  it("metric cards use the latest finished run; an undefined metric is N/A", () => {
    renderView();
    const cards = screen.getByTestId("dashboard-metric-cards");
    expect(cards).toHaveTextContent("100%"); // recall of r3
    expect(cards).toHaveTextContent("50%"); // precision of r3
    expect(cards).toHaveTextContent("N/A"); // citation of r3 is undefined
  });

  it("warns when precision dipped vs the previous finished run", () => {
    renderView();
    expect(screen.getByTestId("dashboard-precision-dip")).toHaveTextContent("Precision dipped 25pt on v3");
  });

  it("plots only finished runs with all three metrics and says how many were skipped", () => {
    renderView();
    expect(JSON.parse(screen.getByTestId("line-chart").getAttribute("data-points")!)).toEqual([
      [0.25, 0.5],
      [0.5, 0.75],
      [0.7, 0.8],
    ]);
    expect(screen.getByTestId("dashboard-trend-skipped")).toHaveTextContent("1 finished run is not plotted because a metric is N/A.");
  });

  it("lists runs with status, N/A and cost; failed runs cannot be selected", () => {
    renderView();
    const rows = screen.getAllByTestId("dashboard-run-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["failed", "done", "done", "done"]);
    expect(within(rows[0]!).queryByRole("checkbox")).toBeNull();
    expect(rows[1]).toHaveTextContent("N/A");
    expect(rows[1]).toHaveTextContent("$0.0020");
  });

  it("clicking a row opens ?run=; ?run= shows the run detail", () => {
    renderView();
    fireEvent.click(screen.getAllByTestId("dashboard-run-row")[2]!);
    expect(replace).toHaveBeenCalledWith("/eval?agent=a1&run=r2");
    cleanup();
    params = new URLSearchParams("agent=a1&run=r2");
    renderView();
    expect(screen.getByTestId("run-detail")).toBeTruthy();
    expect(screen.getByText("Eval run · v2")).toBeTruthy();
  });
});

describe("EvalDashboardView — compare and run", () => {
  const checkbox = (i: number) => within(screen.getAllByTestId("dashboard-run-row")[i]!).getByRole("checkbox");
  const compareBtn = () => screen.getByRole("button", { name: D.compare }) as HTMLButtonElement;

  it("enables Compare with exactly two finished runs and compares older → newer", () => {
    renderView();
    expect(compareBtn().disabled).toBe(true);
    fireEvent.click(checkbox(1)); // r3 (newer)
    expect(compareBtn().disabled).toBe(true);
    fireEvent.click(checkbox(3)); // r1 (older)
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(compareBtn());
    expect(screen.getByText("Compare runs · v1 → v3")).toBeTruthy();
    expect(compareArgs.at(-1)).toEqual(["r1", "r3"]);
  });

  it("a third pick replaces the oldest pick", () => {
    renderView();
    fireEvent.click(checkbox(1));
    fireEvent.click(checkbox(2));
    fireEvent.click(checkbox(3));
    const selected = screen.getAllByTestId("dashboard-run-row").filter((r) => r.hasAttribute("data-selected"));
    expect(selected.map((r) => r.getAttribute("data-status"))).toHaveLength(2);
    expect(checkbox(1)).toHaveAttribute("aria-checked", "false");
  });

  it("Run evals asks first (paid calls) and starts one run on confirm", async () => {
    startAsync.mockResolvedValue({ id: "r9" });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: D.runEvals }));
    expect(screen.getByTestId("run-evals-confirm")).toHaveTextContent("Runs Test Reviewer v4 on 2 eval cases (1 distinct input).");
    expect(startAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: messages.evalsTab.confirm.start }));
    await waitFor(() => expect(startAsync).toHaveBeenCalledTimes(1));
  });

  it("disables Run evals while a run is in progress", () => {
    runsQ = q([run("r5", "running"), ...runsQ.data!]);
    renderView();
    expect(screen.getByTestId("dashboard-running")).toBeTruthy();
    expect((screen.getByRole("button", { name: D.runEvals }) as HTMLButtonElement).disabled).toBe(true);
  });
});
