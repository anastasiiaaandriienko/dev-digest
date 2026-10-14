import type { LogLine } from "@devdigest/ui";
import type { RunTrace } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

// ---- L01: findings in the trace + log (client spec §6) ---------------------
// The engine reports findings in the log only as text
// (reviewer-core/src/review/run.ts): "<chunk>: N candidate finding(s)",
// "Reduced to N finding(s); …", one `grounding dropped "<title>": <reason>`
// per dropped finding, then "Citation grounding: k/n passed".

const CANDIDATES_RE = /: (\d+) candidate finding\(s\)$/;
const REDUCED_RE = /^Reduced to (\d+) finding\(s\)/;
const DROPPED_RE = /^grounding dropped "(.*)": ([\s\S]*)$/;
const FINDING_LINE_RE = /candidate finding\(s\)|^Reduced to \d+ finding|^grounding dropped |^Citation grounding:|^Persisted review /;

export interface DroppedFinding {
  title: string;
  reason: string;
}

/** Findings dropped by the grounding gate, parsed from the log (title + reason only). */
export function droppedFromLog(lines: readonly { m: string }[]): DroppedFinding[] {
  const out: DroppedFinding[] = [];
  for (const l of lines) {
    const m = DROPPED_RE.exec(l.m);
    if (m) out.push({ title: m[1]!, reason: m[2]! });
  }
  return out;
}

/** Whether a log line is about findings (candidates, reduce, grounding, persistence). */
export function isFindingLogLine(msg: string): boolean {
  return FINDING_LINE_RE.test(msg);
}

export interface LogFindingsSummary {
  /** Sum of candidate findings over all chunks; null when no chunk reported yet. */
  candidates: number | null;
  /** Findings after the reduce step; null until it ran. */
  reduced: number | null;
  dropped: DroppedFinding[];
}

/** What the log says about findings so far (works for live and persisted logs). */
export function findingsFromLog(lines: readonly { m: string }[]): LogFindingsSummary {
  let candidates: number | null = null;
  let reduced: number | null = null;
  for (const l of lines) {
    const c = CANDIDATES_RE.exec(l.m);
    if (c) candidates = (candidates ?? 0) + Number(c[1]);
    const r = REDUCED_RE.exec(l.m);
    if (r) reduced = Number(r[1]);
  }
  return { candidates, reduced, dropped: droppedFromLog(lines) };
}

export type GroundingTone = "ok" | "warn" | "muted";

/**
 * Grounding badge tone: all passed → ok; some dropped → warn; nothing to
 * ground ("0/0"), a failed run, or an unreadable value → muted.
 */
export function groundingTone(grounding: string, failed = false): GroundingTone {
  const m = /^(\d+)\/(\d+) passed$/.exec(grounding.trim());
  if (failed || !m) return "muted";
  const kept = Number(m[1]);
  const total = Number(m[2]);
  if (total === 0) return "muted";
  return kept === total ? "ok" : "warn";
}
