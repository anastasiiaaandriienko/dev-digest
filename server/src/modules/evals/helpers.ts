import { createHash } from 'node:crypto';
import {
  AgentEvalCase,
  AgentEvalRun,
  EvalCaseMeta,
  EvalCaseOutcome,
  EvalCounts,
  EvalExpectation,
} from '@devdigest/shared';
import type { EvalCaseKind, EvalErrorCode, Finding, UnifiedDiff } from '@devdigest/shared';
import type { AgentEvalRunRow, EvalCaseRow } from '../../db/rows.js';
import { AppError } from '../../platform/errors.js';
import { groundFindings } from '../../platform/grounding.js';
import { EVAL_MAX_SPAN_LINES } from './constants.js';

/**
 * Pure row → DTO mappers for the eval module. No DB, no I/O (unit-tested).
 *
 * `eval_cases` rows that predate L06 (`kind IS NULL`, skill-owned, or jsonb that
 * no longer parses) are legacy: `toAgentEvalCase` returns null for them so the
 * agent pipeline never reads, scores or rewrites them (spec §5).
 */

/** The latest per-case result of a case, if any (from `eval_runs`). */
export interface EvalCaseLastResultRow {
  caseId: string;
  suiteRunId: string;
  outcome: string | null;
  ranAt: Date;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toAgentEvalCase(row: EvalCaseRow, last?: EvalCaseLastResultRow): AgentEvalCase | null {
  if (row.ownerKind !== 'agent' || !row.kind || !row.inputHash) return null;
  const expected = EvalExpectation.safeParse(row.expectedOutput);
  const meta = EvalCaseMeta.safeParse(row.inputMeta);
  if (!expected.success || !meta.success || expected.data.kind !== row.kind) return null;
  const outcome = last ? EvalCaseOutcome.safeParse(last.outcome) : undefined;
  return {
    id: row.id,
    agent_id: row.ownerId,
    name: row.name,
    kind: row.kind,
    notes: row.notes,
    expected: expected.data,
    meta: meta.data,
    input_hash: row.inputHash,
    created_at: iso(row.createdAt),
    source_finding_id: row.sourceFindingId,
    last_result:
      last && outcome?.success
        ? { suite_run_id: last.suiteRunId, outcome: outcome.data, ran_at: last.ranAt.toISOString() }
        : null,
  };
}

/** Map an `agent_eval_runs` row. Unparseable `counts` jsonb degrades to null, never throws. */
export function toAgentEvalRun(row: AgentEvalRunRow): AgentEvalRun {
  const counts = row.counts == null ? null : EvalCounts.safeParse(row.counts);
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    prompt_sha: row.promptSha,
    status: row.status,
    error: row.error,
    started_at: row.startedAt.toISOString(),
    finished_at: iso(row.finishedAt),
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    counts: counts?.success ? counts.data : null,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
  };
}

/** Clamp a requested history page size into [1, max]; missing → default. */
export function clampLimit(limit: number | undefined, def: number, max: number): number {
  if (limit == null || !Number.isFinite(limit)) return def;
  return Math.min(max, Math.max(1, Math.trunc(limit)));
}

// ---- errors ------------------------------------------------------------------

const EVAL_ERROR_STATUS: Record<EvalErrorCode, number> = {
  finding_not_decided: 409,
  eval_case_exists: 409,
  duplicate_location: 409,
  conflicting_label: 409,
  finding_has_no_agent: 422,
  location_not_in_diff: 422,
  range_too_wide: 422,
  diff_unavailable: 422,
  diff_too_large: 413,
  eval_run_in_progress: 409,
  no_eval_cases: 422,
  too_many_cases: 422,
  different_agents: 422,
  run_not_done: 409,
};

/** An `AppError` carrying one of the documented eval error codes (spec §6.2, §14). */
export function evalError(code: EvalErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, EVAL_ERROR_STATUS[code], details);
}

// ---- locations (shared with the scorer, spec §8.1) ---------------------------

/**
 * Normalize a repo-relative path: trim, `\` → `/`, drop leading `./` and `/`,
 * collapse `//`. Case-sensitive; `a/` / `b/` prefixes are NOT stripped (the diff
 * parser already removed them, and they may be real directories).
 */
export function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  for (;;) {
    if (p.startsWith('./')) p = p.slice(2);
    else if (p.startsWith('/')) p = p.slice(1);
    else return p;
  }
}

export interface LineRange {
  lo: number;
  hi: number;
}

/** `[min, max]` of the two lines; null when a line is not an integer ≥ 1 (invalid citation). */
export function normalizeRange(start: number, end: number): LineRange | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return lo >= 1 ? { lo, hi } : null;
}

/** Inclusive number of lines of a range. */
export function spanLines(r: LineRange): number {
  return r.hi - r.lo + 1;
}

export function isTooWide(r: LineRange): boolean {
  return spanLines(r) > EVAL_MAX_SPAN_LINES;
}

/** Same normalized path and inclusive line overlap (spec §8.1). */
export function locationsOverlap(
  a: { file: string; start_line: number; end_line: number },
  b: { file: string; start_line: number; end_line: number },
): boolean {
  if (normalizePath(a.file) !== normalizePath(b.file)) return false;
  const ra = normalizeRange(a.start_line, a.end_line);
  const rb = normalizeRange(b.start_line, b.end_line);
  return !!ra && !!rb && ra.lo <= rb.hi && rb.lo <= ra.hi;
}

/**
 * Does the expectation sit on the frozen diff? Exactly the engine's citation gate
 * (`groundFindings`): file present and range intersecting new-side hunk lines;
 * full-file kinds (secret_leak, …) only need the file.
 */
export function locationInDiff(
  expected: { file: string; start_line: number; end_line: number; severity: Finding['severity']; category: Finding['category']; title: string },
  findingKind: Finding['kind'],
  diff: UnifiedDiff,
): boolean {
  const probe: Finding = {
    id: 'eval-probe',
    severity: expected.severity,
    category: expected.category,
    title: expected.title,
    file: expected.file,
    start_line: expected.start_line,
    end_line: expected.end_line,
    rationale: '',
    confidence: 1,
    kind: findingKind ?? 'finding',
  };
  return groundFindings([probe], diff).kept.length === 1;
}

// ---- case creation (spec §7) ------------------------------------------------

/** The label is derived on the server from the stored decision (never from the client). */
export function labelFromDecision(f: { acceptedAt: Date | null; dismissedAt: Date | null }): EvalCaseKind | null {
  if (f.acceptedAt) return 'must_find';
  if (f.dismissedAt) return 'must_not_flag';
  return null;
}

export const EVAL_CASE_NAME_MAX = 80;

/** Default case name (design `findingToSeed`): `must-find-<slug>` / `no-<slug>`. */
export function defaultCaseName(kind: EvalCaseKind, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'finding';
  return `${kind === 'must_find' ? 'must-find' : 'no'}-${slug}`;
}

/** `name`, or `name-2`, `name-3`, … — the first one not taken by the agent, within 80 chars. */
export function uniqueCaseName(base: string, taken: ReadonlySet<string>): string {
  const root = base.slice(0, EVAL_CASE_NAME_MAX).replace(/-+$/g, '');
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, EVAL_CASE_NAME_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** sha256 of the frozen input: diff + PR title + PR body (spec §10). */
export function computeInputHash(diff: string, prTitle: string, prBody: string | null): string {
  return createHash('sha256').update(`${diff}\0${prTitle}\0${prBody ?? ''}`).digest('hex');
}

export function diffStats(diff: UnifiedDiff): EvalCaseMeta['diff_stats'] {
  return {
    files: diff.files.length,
    additions: diff.files.reduce((n, f) => n + f.additions, 0),
    deletions: diff.files.reduce((n, f) => n + f.deletions, 0),
  };
}

/**
 * One location = one case (spec §7.5): against the agent's labeled cases on the
 * SAME frozen input, an overlapping case of the same kind is a duplicate, of the
 * opposite kind a conflict. Legacy / unparseable rows are ignored.
 */
export function findLocationConflict(
  expected: EvalExpectation,
  sameInput: readonly EvalCaseRow[],
): { code: 'duplicate_location' | 'conflicting_label'; caseId: string } | null {
  let conflict: { code: 'duplicate_location' | 'conflicting_label'; caseId: string } | null = null;
  for (const row of sameInput) {
    if (!row.kind) continue;
    const other = EvalExpectation.safeParse(row.expectedOutput);
    if (!other.success || !locationsOverlap(expected, other.data)) continue;
    if (row.kind === expected.kind) return { code: 'duplicate_location', caseId: row.id };
    conflict ??= { code: 'conflicting_label', caseId: row.id };
  }
  return conflict;
}
