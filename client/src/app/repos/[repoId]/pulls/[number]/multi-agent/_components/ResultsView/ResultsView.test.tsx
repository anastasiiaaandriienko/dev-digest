import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, AgentColumnFinding, MultiAgentRun } from "@devdigest/shared";
import multiAgent from "../../../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../../../messages/en/prReview.json";

/**
 * L07 T10 — Results page (AC-MAR-32..41, 45..47, 49, 58). Data hooks, SSE and
 * the trace drawer are mocked; the real columns/tabs/FindingCard render.
 */

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

let pullsQ: { data?: unknown[]; isLoading?: boolean; isError?: boolean; refetch: () => void };
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => pullsQ }));

let multiQ: { data?: { multi_run: MultiAgentRun | null }; isLoading?: boolean; isError?: boolean; refetch: () => void };
vi.mock("@/lib/hooks/multi-agent", () => ({ useMultiAgentRun: () => multiQ }));

// SSE: record which runs RunStatus subscribes to.
const streamed = new Set<string>();
const mutate = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (ids: string[]) => {
    ids.forEach((id) => streamed.add(id));
    return { events: [], running: ids.length > 0 };
  },
  useFindingAction: () => ({ mutate }),
  useFindingDecisionStatus: () => new Map(),
}));

const drawerProps: Record<string, unknown>[] = [];
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer", () => ({
  default: (p: Record<string, unknown>) => {
    drawerProps.push(p);
    return <div data-testid="trace-drawer">{String(p.runId)}</div>;
  },
}));
vi.mock("@/app/repos/[repoId]/pulls/[number]/_components/AddToEvalModal", () => ({ AddToEvalModal: () => null }));

import { ResultsView } from "./ResultsView";

const finding = (id: string, o: Partial<AgentColumnFinding> = {}): AgentColumnFinding => ({
  id,
  severity: "CRITICAL",
  category: "security",
  title: `Finding ${id}`,
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  kind: "finding",
  rationale: `Rationale ${id}`,
  suggestion: `Fix ${id}`,
  confidence: 0.98,
  review_id: "rev",
  accepted_at: null,
  dismissed_at: null,
  eval_case_id: null,
  ...o,
});

const column = (n: number, o: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: `run-${n}`,
  agent_id: `agent-${n}`,
  agent_name: `Agent ${n}`,
  provider: "openai",
  model: "m",
  status: "done",
  error: null,
  verdict: "comment",
  score: 60 + n,
  summary: `Summary ${n}`,
  duration_ms: 8200,
  cost_usd: 0.03,
  findings: [],
  ...o,
});

function multiRun(columns: AgentColumn[], o: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "multi-1",
    pr_id: "pr-482",
    pr_number: 482,
    ran_at: "2026-10-23T10:00:00.000Z",
    agent_count: columns.length,
    total_duration_ms: 24600,
    wall_clock_ms: 8200,
    total_cost_usd: 0.09,
    cost_partial: false,
    columns,
    groups: [],
    conflicts: [],
    ...o,
  };
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview }}>
      <ResultsView repoId="repo-1" prNumber={482} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  mutate.mockReset();
  streamed.clear();
  drawerProps.length = 0;
  search = new URLSearchParams();
  pullsQ = { data: [{ id: "pr-482", number: 482, title: "Add rate limiting", head_sha: "abc" }], refetch: vi.fn() };
  multiQ = {
    data: {
      multi_run: multiRun([
        column(1, { findings: [finding("f1"), finding("f2", { severity: "WARNING", start_line: 40, end_line: 52 })] }),
        column(2, { findings: [finding("f3", { accepted_at: "2026-10-23T10:05:00.000Z" })] }),
        column(3),
      ]),
    },
    refetch: vi.fn(),
  };
});
afterEach(cleanup);

describe("ResultsView — states", () => {
  it("shows a skeleton while loading", () => {
    multiQ = { isLoading: true, refetch: vi.fn() };
    renderPage();
    expect(screen.getByTestId("results-loading")).toBeInTheDocument();
  });

  it("shows an error with Retry when the multi-run cannot be loaded", () => {
    multiQ = { isError: true, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(multiAgent.results.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(multiQ.refetch).toHaveBeenCalled();
  });

  it("AC-MAR-46/47: no multi-run → empty state whose Start new review opens Configure run with ?pr=", () => {
    multiQ = { data: { multi_run: null }, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(multiAgent.results.emptyTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start new review" }));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/multi-agent?pr=pr-482");
  });

  it("an unknown PR number shows the error state", () => {
    pullsQ = { data: [], refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(multiAgent.results.loadError)).toBeInTheDocument();
  });
});

describe("ResultsView — header (AC-MAR-32, 47, 49)", () => {
  it("shows Configure run, title, agent count, PR line and the parallel summary", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText("3 selected agents · parallel")).toBeInTheDocument();
    expect(screen.getByText("#482 Add rate limiting")).toBeInTheDocument();
    expect(screen.getByTestId("results-summary")).toHaveTextContent("3 agents · parallel · 8.2s total · $0.09");
    expect(document.body.textContent?.toLowerCase()).not.toContain("worktree");
    fireEvent.click(screen.getByRole("button", { name: "Configure run" }));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/multi-agent?pr=pr-482");
  });

  it("flags a partial total cost", () => {
    multiQ.data!.multi_run = multiRun([column(1)], { cost_partial: true, total_cost_usd: 0.03 });
    renderPage();
    expect(screen.getByTestId("results-summary")).toHaveTextContent("≥ $0.03");
    expect(screen.getByText(multiAgent.results.costPartial)).toBeInTheDocument();
  });

  it("the Columns/Tabs toggle is kept in ?view (default columns)", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(replace).toHaveBeenCalledWith("/repos/repo-1/pulls/482/multi-agent?view=tabs");
  });
});

describe("ResultsView — Columns (AC-MAR-33..36, 45, 58)", () => {
  it("one column per run in server order with name, time, cost, score, findings and footer", () => {
    renderPage();
    const strip = screen.getByTestId("columns-strip");
    const cols = within(strip).getAllByRole("region");
    expect(cols.map((c) => c.getAttribute("aria-label"))).toEqual(["Agent 1", "Agent 2", "Agent 3"]);
    const first = screen.getByTestId("column-run-1");
    expect(within(first).getByText("8.2s · $0.03")).toBeInTheDocument();
    expect(within(first).getByText("Finding f1")).toBeInTheDocument();
    expect(within(first).getByText("src/config.ts:40–52")).toBeInTheDocument();
    expect(within(first).getByText("2 findings")).toBeInTheDocument();
    expect(within(screen.getByTestId("column-run-3")).getByText("No findings")).toBeInTheDocument();
  });

  it("failed and cancelled columns show the status and error and keep View trace", () => {
    multiQ.data!.multi_run = multiRun([
      column(1, { status: "failed", error: "provider down", score: null }),
      column(2, { status: "cancelled", error: null, score: null }),
      column(3, { findings: [finding("f9")] }),
    ]);
    renderPage();
    expect(within(screen.getByTestId("column-run-1")).getByRole("alert")).toHaveTextContent("Failed");
    expect(within(screen.getByTestId("column-run-1")).getByText("provider down")).toBeInTheDocument();
    expect(within(screen.getByTestId("column-run-2")).getByText("No error recorded")).toBeInTheDocument();
    expect(within(screen.getByTestId("column-run-2")).getByRole("button", { name: /View trace/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("column-run-3")).getByText("Finding f9")).toBeInTheDocument();
  });

  it("AC-MAR-45: on (re)load only non-terminal runs are streamed; partial results stay visible", () => {
    multiQ.data!.multi_run = multiRun([
      column(1, { findings: [finding("f1")] }),
      column(2, { status: "running", duration_ms: null, score: null }),
      column(3, { status: "failed", error: "x" }),
      column(4, { status: "running", duration_ms: null, score: null }),
    ]);
    renderPage();
    expect([...streamed].sort()).toEqual(["run-2", "run-4"]);
    expect(within(screen.getByTestId("column-run-1")).getByText("Finding f1")).toBeInTheDocument();
  });

  it("A-T3: at most 4 columns stream; the rest show Running", () => {
    multiQ.data!.multi_run = multiRun(
      Array.from({ length: 6 }, (_, i) => column(i + 1, { status: "running", duration_ms: null, score: null }))
    );
    renderPage();
    expect([...streamed].sort()).toEqual(["run-1", "run-2", "run-3", "run-4"]);
    expect(within(screen.getByTestId("column-run-6")).getByText("Running")).toBeInTheDocument();
  });

  it("an open trace drawer on a running run takes one of the 4 streams", () => {
    multiQ.data!.multi_run = multiRun(
      Array.from({ length: 5 }, (_, i) => column(i + 1, { status: "running", duration_ms: null, score: null }))
    );
    search = new URLSearchParams("trace=run-1");
    renderPage();
    expect([...streamed].sort()).toEqual(["run-1", "run-2", "run-3"]);
    expect(drawerProps.at(-1)).toMatchObject({ runId: "run-1", running: true });
  });

  it("AC-MAR-36: View trace opens RunTraceDrawer via ?trace= and closing removes it", () => {
    renderPage();
    fireEvent.click(within(screen.getByTestId("column-run-2")).getByRole("button", { name: /View trace/ }));
    expect(replace).toHaveBeenCalledWith("/repos/repo-1/pulls/482/multi-agent?trace=run-2");
    cleanup();
    search = new URLSearchParams("trace=run-2");
    renderPage();
    expect(screen.getByTestId("trace-drawer")).toHaveTextContent("run-2");
    expect(drawerProps.at(-1)).toMatchObject({ agentName: "Agent 2", prNumber: 482, runStatus: "done", running: false });
    (drawerProps.at(-1)!.onClose as () => void)();
    expect(replace).toHaveBeenLastCalledWith("/repos/repo-1/pulls/482/multi-agent");
  });

  it("AC-MAR-58: fixed-width columns in a horizontally scrolling strip (more than 4 never shrink)", () => {
    multiQ.data!.multi_run = multiRun(Array.from({ length: 6 }, (_, i) => column(i + 1)));
    renderPage();
    expect(screen.getByTestId("columns-strip").style.overflowX).toBe("auto");
    for (const c of within(screen.getByTestId("columns-strip")).getAllByRole("region")) {
      expect(c.style.flex).toBe("0 0 280px");
    }
  });
});

describe("ResultsView — Tabs (AC-MAR-37..41)", () => {
  beforeEach(() => {
    search = new URLSearchParams("view=tabs");
  });

  it("one tab per agent with its score; the selected agent's header and expandable findings", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Tabs" })).toHaveAttribute("aria-pressed", "true");
    for (const n of [1, 2, 3]) expect(screen.getByText(`Agent ${n}`, { selector: "button *, button" })).toBeInTheDocument();
    const head = screen.getByTestId("tab-agent-head");
    expect(within(head).getByText("Summary 1")).toBeInTheDocument();
    expect(within(head).getByText("8.2s · $0.03")).toBeInTheDocument();
    expect(within(head).getByRole("button", { name: /View trace/ })).toBeInTheDocument();
    // The first card is expanded: rationale and suggested fix.
    expect(screen.getByText("Rationale f1")).toBeInTheDocument();
    expect(screen.getByText("Fix f1")).toBeInTheDocument();
  });

  it("switching tabs shows another agent", () => {
    renderPage();
    fireEvent.click(screen.getByText("Agent 2", { selector: "button *, button" }));
    expect(within(screen.getByTestId("tab-agent-head")).getByText("Summary 2")).toBeInTheDocument();
    expect(screen.getByText("Finding f3")).toBeInTheDocument();
  });

  it("AC-MAR-38: Accept calls the existing finding action for this PR", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /Accept/ })[0]!);
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr-482" });
  });

  it("AC-MAR-40/41: Learn is disabled with an explanation and sends nothing; no Reply to author", () => {
    renderPage();
    const learn = screen.getAllByRole("button", { name: /Learn/ })[0]!;
    expect(learn).toBeDisabled();
    expect(learn.parentElement).toHaveAttribute("title", "Learning from findings is not available yet");
    fireEvent.click(learn);
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/reply to author/i)).not.toBeInTheDocument();
  });

  it("AC-MAR-39: a decided finding offers Turn into eval case (AddToEvalModal's precondition)", () => {
    renderPage();
    fireEvent.click(screen.getByText("Agent 2", { selector: "button *, button" }));
    // f3 is Agent 2's first card, so it is already expanded.
    expect(screen.getByRole("button", { name: /Turn into eval case/i })).toBeInTheDocument();
  });
});
