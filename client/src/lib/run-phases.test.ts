import { describe, it, expect } from "vitest";
import { phaseOf, phasesFrom, RUN_PHASES, type PhaseLogLine } from "./run-phases";

/** Phase states as a compact string, e.g. "CSAPP". */
function states(lines: PhaseLogLine[], status?: string | null): string {
  return phasesFrom(lines, status)
    .phases.map((p) => ({ pending: "P", active: "A", completed: "C", skipped: "S", failed: "F" })[p.state])
    .join("");
}

const L = (msg: string, kind = "info"): PhaseLogLine => ({ msg, kind });

// Message shapes copied from the real emitters (pinned against them by
// server/test/run-phases.test.ts).
const INIT = [
  L("Loading PR diff…", "tool"),
  L("Loading PR diff done (12ms)", "tool"),
  L("Diff ready — 2 changed file(s); starting 1 agent run(s)"),
  L('Starting review with agent "Sec" (openai/gpt-4.1)'),
  L("Resolving openai provider…", "tool"),
  L("Resolving openai provider done (3ms)", "tool"),
];
/** Planning explicitly skipped: the agent has repo-intel disabled. */
const PLAN_SKIPPED = [L("Repo intel disabled for this agent — skipping context enrichment")];
/** Planning that ran and attached context. */
const PLAN_RAN = [L("callers digest: 2 caller signature(s) attached"), L("repo map: 120 token(s) attached (cached=true)")];
const STRATEGY = L("Reviewing 2 changed file(s) in one pass");
const IMPL = [
  STRATEGY,
  L("Reviewing all files in one pass", "tool"),
  L("all files: 2 candidate finding(s)", "result"),
  L("Reduced to 2 finding(s); verdict=request_changes, score=40", "result"),
];
const VALID = [L('grounding dropped "X": line 9 is not in the diff'), L("Citation grounding: 1/2 passed", "result")];
const DONE = [L("Persisted review r1 with 1 finding(s)", "result"), L("Run complete; trace persisted")];

describe("phaseOf", () => {
  it("classifies lifecycle messages and ignores the rest", () => {
    expect(phaseOf("Loading PR diff…")).toEqual({ phase: 0, end: false, skip: false });
    expect(phaseOf("Resolving openai provider done (3ms)")).toEqual({ phase: 0, end: true, skip: false });
    expect(phaseOf("callers digest: 1 caller signature(s) attached")).toEqual({ phase: 1, end: false, skip: false });
    expect(phaseOf("Reviewing 3 changed file(s) in one pass")).toEqual({ phase: 2, end: false, skip: false });
    expect(phaseOf("Large diff → map-reduce over 3 files")).toEqual({ phase: 2, end: false, skip: false });
    expect(phaseOf("Reviewing all files in one pass")).toEqual({ phase: 2, end: false, skip: false });
    expect(phaseOf("Citation grounding: 1/1 passed")).toEqual({ phase: 3, end: true, skip: false });
    expect(phaseOf("Run complete (confirmed after a persistence error)")).toEqual({ phase: 4, end: true, skip: false });
    expect(phaseOf("Cancellation requested — stopping…")).toBeNull();
  });

  it("only the executor's explicit repo-intel skip line is a skip signal", () => {
    expect(phaseOf("Repo intel disabled for this agent — skipping context enrichment")).toEqual({
      phase: 1,
      end: true,
      skip: true,
    });
    // A failed lookup is logged, but the phase still ran — not a skip.
    expect(phaseOf("callers digest: repoIntel failed — boom")!.skip).toBe(false);
  });
});

describe("phasesFrom — live runs", () => {
  it("before any event, Initiation is active", () => {
    expect(states([], "running")).toBe("APPPP");
  });

  it.each([
    ["mid-initiation", INIT.slice(0, 3), "APPPP"],
    ["provider resolved → Planning in progress", INIT, "CAPPP"],
    ["Planning attaching context", [...INIT, ...PLAN_RAN], "CAPPP"],
    ["Planning skipped (event) → Implementation in progress", [...INIT, ...PLAN_SKIPPED], "CSAPP"],
    ["strategy chosen after context → Implementation in progress", [...INIT, ...PLAN_RAN, STRATEGY], "CCAPP"],
    ["model answered, before reduce", [...INIT, ...PLAN_SKIPPED, ...IMPL.slice(0, 3)], "CSAPP"],
    ["reduced → Validation in progress", [...INIT, ...PLAN_SKIPPED, ...IMPL], "CSCAP"],
    ["grounded → Completion in progress (persisting)", [...INIT, ...PLAN_SKIPPED, ...IMPL, ...VALID], "CSCCA"],
  ])("%s", (_label, lines, expected) => {
    expect(states(lines, "running")).toBe(expected);
  });

  it("silence is never 'skipped': repo-intel on but nothing attached logs nothing → Planning completed", () => {
    expect(states([...INIT, STRATEGY], "running")).toBe("CCAPP");
  });

  it("map-reduce reports file k of n during Implementation", () => {
    const lines = [
      ...INIT,
      L("Large diff → map-reduce over 3 files"),
      L("map: reviewing a.ts", "tool"),
      L("a.ts: 1 candidate finding(s)", "result"),
      L("map: reviewing b.ts", "tool"),
    ];
    const r = phasesFrom(lines, "running");
    expect(r.progress).toEqual({ started: 2, total: 3 });
    expect(r.phases[2]!.state).toBe("active");
  });
});

describe("phasesFrom — terminal runs", () => {
  it("done: every phase completed, an explicitly skipped one stays skipped", () => {
    expect(states([...INIT, ...PLAN_RAN, ...IMPL, ...VALID], "done")).toBe("CCCCC");
    expect(states([...INIT, ...PLAN_SKIPPED, ...IMPL, ...VALID], "done")).toBe("CSCCC");
    expect(phasesFrom([], "done").outcome).toBe("done");
    expect(states([], "done")).toBe("CCCCC"); // no log → no skip evidence
  });

  it("without a status, the live log's own completion lines make it done", () => {
    expect(states([...INIT, ...PLAN_SKIPPED, ...IMPL, ...VALID, ...DONE])).toBe("CSCCC");
  });

  it("diff load failure → Initiation failed", () => {
    const lines = [L("Loading PR diff…", "tool"), L("Loading PR diff failed (5ms): boom", "error"), L("Failed to load PR diff: boom", "error")];
    expect(states(lines, "failed")).toBe("FPPPP");
    expect(states(lines)).toBe("FPPPP"); // error lines alone imply failed
  });

  it("provider failure → Initiation failed", () => {
    const lines = [...INIT.slice(0, 5), L("Resolving openai provider failed (1ms): no key", "error"), L("Run failed: no key", "error")];
    expect(states(lines, "failed")).toBe("FPPPP");
  });

  it("model failure after the strategy line → Implementation failed (skipped Planning kept)", () => {
    expect(states([...INIT, ...PLAN_SKIPPED, STRATEGY, L("Run failed: provider down", "error")], "failed")).toBe("CSFPP");
  });

  it("failure right after Planning was skipped → Implementation failed", () => {
    expect(states([...INIT, ...PLAN_SKIPPED, L("Run failed: boom", "error")], "failed")).toBe("CSFPP");
  });

  it("persistence failure after grounding → Completion failed", () => {
    expect(states([...INIT, ...PLAN_RAN, ...IMPL, ...VALID, L("Run failed: jsonb", "error")], "failed")).toBe("CCCCF");
  });

  it("cancelled at the model checkpoint → Implementation failed, marked cancelled", () => {
    const r = phasesFrom([...INIT, ...PLAN_SKIPPED, STRATEGY, L("Run cancelled by user", "error")]);
    expect(r.outcome).toBe("cancelled");
    expect(r.phases.map((p) => p.state).join(",")).toBe("completed,skipped,failed,pending,pending");
    expect(r.phases[2]!.cancelled).toBe(true);
  });

  it("a status of cancelled wins over the log", () => {
    expect(phasesFrom(INIT, "cancelled").phases[1]).toEqual({ key: "planning", state: "failed", cancelled: true });
  });

  it("failed with no lifecycle event (reaped run): nothing invented", () => {
    const r = phasesFrom([], "failed");
    expect(r.outcome).toBe("failed");
    expect(r.phases.every((p) => p.state === "pending")).toBe(true);
  });

  it("the persisted status wins over a misleading log (ambiguous commit)", () => {
    const lines = [...INIT, ...PLAN_RAN, ...IMPL, ...VALID, L("Run complete (confirmed after a persistence error)")];
    expect(states(lines, "done")).toBe("CCCCC");
  });

  it("unknown outcome (no status, no terminal line): only proven phases are shown, none active", () => {
    const r = phasesFrom([...INIT, ...PLAN_SKIPPED, STRATEGY]);
    expect(r.outcome).toBe("unknown");
    expect(r.phases.map((p) => p.state)).not.toContain("active");
    expect(states([...INIT, ...PLAN_SKIPPED, STRATEGY])).toBe("CSPPP");
  });

  it("exposes the five phases in lifecycle order", () => {
    expect(RUN_PHASES).toEqual(["initiation", "planning", "implementation", "validation", "completion"]);
  });
});
