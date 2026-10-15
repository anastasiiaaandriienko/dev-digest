/* lib/run-phases.ts — the five review lifecycle phases (L01), DERIVED from a
   run's real event log plus its persisted status. Nothing here invents
   progress: a phase is "completed" only when a later phase's event (or the
   phase's own end event) was observed, or the run is persisted as `done`.

   Pure and import-free on purpose: the server test suite imports this file
   (server/test/run-phases.test.ts) and feeds it the messages the real
   executor + reviewer-core emit, so a server wording change that breaks this
   classifier fails a test instead of silently breaking the UI. */

export const RUN_PHASES = ["initiation", "planning", "implementation", "validation", "completion"] as const;
export type RunPhaseKey = (typeof RUN_PHASES)[number];

/** `skipped` only when an execution event explicitly says the phase's work was skipped. */
export type PhaseState = "pending" | "active" | "completed" | "skipped" | "failed";
export type RunOutcome = "running" | "done" | "failed" | "cancelled" | "unknown";

export interface PhaseView {
  key: RunPhaseKey;
  state: PhaseState;
  /** Set on the failed phase of a cancelled run. */
  cancelled?: boolean;
}

export interface RunPhases {
  phases: PhaseView[];
  outcome: RunOutcome;
  /** Map-reduce only: files whose model call started, out of the planned total. */
  progress: { started: number; total: number } | null;
}

/** A log line, live (`kind`/`msg`) or persisted; only these fields are read. */
export interface PhaseLogLine {
  kind?: string;
  msg: string;
}

interface Rule {
  phase: number;
  re: RegExp;
  /** The phase's last event: once seen, the NEXT phase is the one in progress. */
  end?: boolean;
  /** The event itself says the phase's work was skipped (implies `end`). */
  skip?: boolean;
}

// Index into RUN_PHASES. Rules are tried in order: the engine's strategy lines
// are matched before the generic single-pass chunk line ("Reviewing all files
// in one pass").
//
// Emitters: server/src/modules/reviews/run-executor.ts (+ RunLogger.step's
// "<label>…" / "<label> done (Nms)" / "<label> failed (Nms): …") and
// reviewer-core/src/review/run.ts.
const RULES: Rule[] = [
  // 1 · Initiation — the run is accepted and its inputs are loaded: PR diff,
  //     agent, LLM provider.
  { phase: 0, re: /^Loading PR diff/ },
  { phase: 0, re: /^Failed to load PR diff/ },
  { phase: 0, re: /^Diff ready — / },
  { phase: 0, re: /^Starting review with agent / },
  { phase: 0, re: /^Resolving \S+ provider done \(/, end: true },
  { phase: 0, re: /^Resolving \S+ provider/ },
  // 2 · Planning — context enrichment for the prompt (repo-intel: callers,
  //     repo map, file rank); the original spec's "Context" step. The executor
  //     says explicitly when it skips it, which is the ONLY skip signal:
  //     a repo-intel lookup that finds nothing logs nothing, so silence is
  //     never read as "skipped".
  { phase: 1, re: /^Repo intel disabled for this agent/, end: true, skip: true },
  { phase: 1, re: /^callers digest: / },
  { phase: 1, re: /^repo map: / },
  { phase: 1, re: /^file rank: / },
  // 3 · Implementation — the engine's review strategy, the model call(s) and
  //     the reduce step.
  { phase: 2, re: /^Large diff → map-reduce over \d+ files$/ },
  { phase: 2, re: /^Reviewing \d+ changed file\(s\) in one pass$/ },
  { phase: 2, re: /^map: reviewing / },
  { phase: 2, re: /^Reviewing .+ in one pass$/ },
  { phase: 2, re: /: \d+ candidate finding\(s\)$/ },
  { phase: 2, re: /^Reduced to \d+ finding\(s\)/, end: true },
  // 4 · Validation — the citation-grounding gate.
  { phase: 3, re: /^grounding dropped "/ },
  { phase: 3, re: /^Citation grounding: /, end: true },
  // 5 · Completion — persistence (published only after the commit).
  { phase: 4, re: /^Persisted review / },
  { phase: 4, re: /^Run complete/, end: true },
];

const MAP_TOTAL_RE = /^Large diff → map-reduce over (\d+) files$/;
const MAP_STEP_RE = /^map: reviewing /;
const CANCELLED_RE = /^Run cancelled by user$/;

/** Phase index of one message, or null if it is not a lifecycle event. */
export function phaseOf(msg: string): { phase: number; end: boolean; skip: boolean } | null {
  for (const r of RULES) if (r.re.test(msg)) return { phase: r.phase, end: !!(r.end || r.skip), skip: !!r.skip };
  return null;
}

function normaliseStatus(status: string | null | undefined): RunOutcome | null {
  if (status === "running" || status === "done" || status === "failed" || status === "cancelled") return status;
  return null;
}

/**
 * Derive the five phases.
 * - `status` is the run's persisted / known status (agent_runs.status, or
 *   "running" while its SSE stream is open). It wins over the log.
 * - Without a status, the log's own terminal lines decide ("Run complete…",
 *   "Run cancelled by user", any `error` line); otherwise the outcome is unknown
 *   and no phase is shown as active.
 * - A persisted trace never contains the post-commit Completion lines, so a
 *   `done` run is completed on its status, not on those lines.
 */
export function phasesFrom(lines: readonly PhaseLogLine[], status?: string | null): RunPhases {
  let cur = -1;
  let endSeen = false;
  let mapTotal: number | null = null;
  let mapStarted = 0;
  let sawError = false;
  let sawCancel = false;
  let sawComplete = false;
  const skipped = new Set<number>();

  for (const l of lines) {
    if (CANCELLED_RE.test(l.msg)) sawCancel = true;
    if (l.kind === "error") sawError = true;
    const total = MAP_TOTAL_RE.exec(l.msg);
    if (total) mapTotal = Number(total[1]);
    if (MAP_STEP_RE.test(l.msg)) mapStarted += 1;
    const p = phaseOf(l.msg);
    if (!p) continue;
    if (p.phase === 4 && p.end) sawComplete = true;
    if (p.skip) skipped.add(p.phase);
    if (p.phase > cur) {
      cur = p.phase;
      endSeen = p.end;
    } else if (p.phase === cur && p.end) {
      endSeen = true;
    }
  }

  const outcome: RunOutcome =
    normaliseStatus(status) ??
    (sawComplete ? "done" : sawCancel ? "cancelled" : sawError ? "failed" : "unknown");

  // The phase in progress (or where the run stopped): after an end event the
  // next phase has begun, even before it emitted anything.
  const at = cur < 0 ? -1 : endSeen && cur < RUN_PHASES.length - 1 ? cur + 1 : cur;

  // A phase the log explicitly skipped reads "skipped" wherever it would
  // otherwise read "completed" (it was passed, but its work did not run).
  const phases: PhaseView[] = RUN_PHASES.map((key, i): PhaseView => {
    const v = baseState(key, i);
    return v.state === "completed" && skipped.has(i) ? { key, state: "skipped" } : v;
  });

  const progress = mapTotal != null ? { started: Math.min(mapStarted, mapTotal), total: mapTotal } : null;
  return { phases, outcome, progress };

  function baseState(key: RunPhaseKey, i: number): PhaseView {
    switch (outcome) {
      case "done":
        return { key, state: "completed" };
      case "running": {
        const active = Math.max(at, 0);
        return { key, state: i < active ? "completed" : i === active ? "active" : "pending" };
      }
      case "failed":
      case "cancelled":
        // No lifecycle event at all (e.g. a run reaped on restart): we cannot
        // say where it stopped, so nothing is marked failed or completed.
        if (at < 0) return { key, state: "pending" };
        if (i < at) return { key, state: "completed" };
        if (i === at) return outcome === "cancelled" ? { key, state: "failed", cancelled: true } : { key, state: "failed" };
        return { key, state: "pending" };
      default:
        // Unknown outcome: only what the log proves is completed.
        return { key, state: i < at || (i === at && endSeen && i === cur) ? "completed" : "pending" };
    }
  }
}
