import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import type { FindingRecord } from "@devdigest/shared";

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

// Swapped per test for the L01 cost cases (read lazily at render time).
let mockTrace: RunTrace = TRACE;

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: mockTrace, isLoading: false }),
}));
type LiveEvents = { events: { t: string; kind: string; msg: string }[]; running: boolean };
let mockLive: LiveEvents = { events: [], running: false };
const useRunEvents = vi.fn((_runIds: string[]) => mockLive);
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: (runIds: string[]) => useRunEvents(runIds),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  mockTrace = TRACE;
  mockLive = { events: [], running: false };
  useRunEvents.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages, prReview: prReviewMessages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it.each([
    ["a priced run", 0.06, "$0.06"],
    ["a tiny cost (3 significant digits, never $0.00)", 0.001, "$0.001"],
    ["a known zero", 0, "$0.00"],
    ["an unknown cost (null)", null, "n/a"],
  ])("shows the Cost stat for %s", (_label, cost, expected) => {
    mockTrace = { ...TRACE, stats: { ...TRACE.stats, cost_usd: cost } };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    const label = screen.getByText(messages.trace.stat.cost);
    expect(label.nextElementSibling).toHaveTextContent(expected);
  });

  it("an old trace without stats.cost_usd shows Cost n/a", () => {
    // TRACE has no cost_usd key at all (pre-L01 document).
    expect("cost_usd" in TRACE.stats).toBe(false);
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText(messages.trace.stat.cost).nextElementSibling).toHaveTextContent("n/a");
  });

  it("places Cost between Tokens and Findings", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    const labels = [messages.trace.stat.duration, messages.trace.stat.tokens, messages.trace.stat.cost, messages.trace.stat.findings];
    const order = labels.map((l) => screen.getByText(l));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

// ---- L01 findings in the Trace drawer and the log (client spec §6, T1–T3) ----

function finding(id: string, severity: FindingRecord["severity"], o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title: `${severity} finding ${id}`,
    file: "src/config.ts",
    start_line: 11,
    end_line: 12,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS = [
  finding("f1", "CRITICAL", { accepted_at: "2026-10-11T10:00:00.000Z" }),
  finding("f2", "WARNING", { dismissed_at: "2026-10-11T10:00:00.000Z" }),
  finding("f3", "CRITICAL"),
];

const DROPPING_TRACE: RunTrace = {
  ...TRACE,
  stats: { ...TRACE.stats, grounding: "1/3 passed", findings: 1 },
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.50", kind: "result", msg: "src/config.ts: 3 candidate finding(s)" },
    { t: "00.60", kind: "result", msg: "Reduced to 3 finding(s); verdict=request_changes, score=40" },
    { t: "00.70", kind: "info", msg: 'grounding dropped "Phantom A": line 999 is not in the diff' },
    { t: "00.71", kind: "info", msg: 'grounding dropped "Phantom B": file not in diff: x.ts' },
    { t: "00.90", kind: "result", msg: "Citation grounding: 1/3 passed" },
  ],
};

function open(props: Partial<React.ComponentProps<typeof RunTraceDrawer>> = {}) {
  return renderWithIntl(
    <RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} {...props} />,
  );
}

describe("Trace drawer — findings (L01)", () => {
  it("T1: lists the run's findings with read-only severity counts and accept/dismiss state", () => {
    open({ findings: FINDINGS });
    const counts = screen.getByLabelText(prReviewMessages.severity.summaryLabel);
    expect(counts.querySelector('[data-severity="CRITICAL"]')).toHaveTextContent("2");
    expect(counts.querySelector('[data-severity="WARNING"]')).toHaveTextContent("1");
    expect(counts.querySelector('[data-severity="SUGGESTION"]')).toHaveTextContent("0");
    // Read-only: the summary has no buttons.
    expect(counts.querySelectorAll("button")).toHaveLength(0);
    const card = (id: string) => document.querySelector(`[data-finding-id="${id}"]`) as HTMLElement;
    expect(card("f1")).toHaveTextContent(messages.trace.findingState.accepted);
    expect(card("f2")).toHaveTextContent(messages.trace.findingState.dismissed);
    expect(card("f3")).not.toHaveTextContent(messages.trace.findingState.accepted);
    expect(card("f1")).toHaveTextContent("src/config.ts:11-12");
  });

  it("no findings: says so and shows no counts", () => {
    open({ findings: [] });
    expect(screen.getByText(messages.trace.noFindings)).toBeInTheDocument();
    expect(screen.queryByLabelText(prReviewMessages.severity.summaryLabel)).not.toBeInTheDocument();
  });

  it("T2: dropped-by-grounding titles and reasons from the log; amber grounding badge", () => {
    mockTrace = DROPPING_TRACE;
    open({ findings: [finding("k1", "CRITICAL")] });
    expect(screen.getByTestId("grounding-badge")).toHaveAttribute("data-tone", "warn");
    expect(screen.queryAllByTestId("dropped-finding")).toHaveLength(0); // collapsed by default
    fireEvent.click(screen.getByRole("button", { name: /Dropped by grounding \(2\)/ }));
    const items = screen.getAllByTestId("dropped-finding");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Phantom A");
    expect(items[0]).toHaveTextContent("line 999 is not in the diff");
  });

  const FAILED_LINE: RunTrace["log"] = [{ t: "01.00", kind: "error", msg: "Run failed: boom" }];
  it.each<[string, string, RunTrace["log"], string]>([
    ["all passed → green", "2/2 passed", [], "ok"],
    ["nothing to ground → muted", "0/0 passed", [], "muted"],
    ["failed run → muted", "2/2 passed", FAILED_LINE, "muted"],
  ])("grounding badge: %s", (_l, grounding, extraLog, tone) => {
    mockTrace = { ...TRACE, stats: { ...TRACE.stats, grounding }, log: [...TRACE.log, ...extraLog] };
    open();
    expect(screen.getByTestId("grounding-badge")).toHaveAttribute("data-tone", tone);
  });

  it("log tab: shows the findings summary and can narrow the log to finding lines", () => {
    mockTrace = DROPPING_TRACE;
    open({ findings: [finding("k1", "CRITICAL")] });
    fireEvent.click(screen.getByText("log"));
    const summary = screen.getByTestId("log-findings");
    expect(summary.querySelector('[data-severity="CRITICAL"]')).toHaveTextContent("1");
    expect(summary).toHaveTextContent("3 candidates · 3 after reduce · 2 dropped by grounding");
    expect(screen.getByText("Starting review with agent Security")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: messages.log.findings.onlyFindingLines }));
    expect(screen.queryByText("Starting review with agent Security")).not.toBeInTheDocument();
    expect(screen.getByText("Citation grounding: 1/3 passed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: messages.log.findings.onlyFindingLines }));
    expect(screen.getByText("Starting review with agent Security")).toBeInTheDocument();
  });

  it("T3: a live run opens on the log tab, streams SSE and summarises findings from events", () => {
    mockLive = {
      running: true,
      events: [{ t: "00.50", kind: "result", msg: "src/config.ts: 2 candidate finding(s)" }],
    };
    open({ running: true });
    expect(useRunEvents).toHaveBeenCalledWith(["r1"]);
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
    expect(screen.getByTestId("log-findings")).toHaveTextContent(messages.log.findings.nonePersisted);
    expect(screen.getByTestId("log-findings")).toHaveTextContent("2 candidates");
  });

  it("phases: a done run shows all five completed even though its trace has no Completion lines", () => {
    open({ runStatus: "done" });
    const states = Array.from(document.querySelectorAll("[data-phase]")).map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["completed", "completed", "completed", "completed", "completed"]);
  });

  it("phases: repo-intel disabled (explicit event) shows Planning as skipped; the rest completed", () => {
    mockTrace = {
      ...TRACE,
      log: [
        { t: "00.10", kind: "tool", msg: "Loading PR diff…" },
        { t: "00.20", kind: "tool", msg: "Resolving openai provider done (2ms)" },
        { t: "00.25", kind: "info", msg: "Repo intel disabled for this agent — skipping context enrichment" },
        { t: "00.30", kind: "info", msg: "Reviewing 1 changed file(s) in one pass" },
        { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
      ],
    };
    open({ runStatus: "done" });
    const states = Array.from(document.querySelectorAll("[data-phase]")).map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["completed", "skipped", "completed", "completed", "completed"]);
    expect(
      screen.getByLabelText(`${prReviewMessages.phases.planning}: ${prReviewMessages.phases.state.skipped}`),
    ).toBeInTheDocument();
  });

  it("phases: a failed run marks where it stopped (from the persisted log)", () => {
    mockTrace = {
      ...TRACE,
      log: [
        { t: "00.10", kind: "tool", msg: "Loading PR diff…" },
        { t: "00.20", kind: "tool", msg: "Resolving openai provider done (2ms)" },
        { t: "00.30", kind: "info", msg: "Reviewing 1 changed file(s) in one pass" },
        { t: "00.40", kind: "error", msg: "Run failed: provider down" },
      ],
    };
    open({ runStatus: "failed" });
    expect(screen.getByTestId("phase-stepper")).toHaveAttribute("data-outcome", "failed");
    expect(document.querySelector('[data-phase="implementation"]')).toHaveAttribute("data-state", "failed");
    expect(document.querySelector('[data-phase="validation"]')).toHaveAttribute("data-state", "pending");
  });

  it("phases: a live run shows the active phase from streamed events", () => {
    mockLive = {
      running: true,
      events: [
        { t: "00.10", kind: "tool", msg: "Loading PR diff…" },
        { t: "00.20", kind: "tool", msg: "Resolving openai provider done (2ms)" },
      ],
    };
    open({ running: true, runStatus: "running" });
    expect(document.querySelector('[data-phase="planning"]')).toHaveAttribute("data-state", "active");
    expect(document.querySelector('[data-phase="planning"]')).toHaveAttribute("aria-current", "step");
  });

  it("a finished run does not subscribe to SSE", () => {
    open();
    expect(useRunEvents.mock.calls.every(([ids]) => ids.length === 0)).toBe(true);
  });
});
