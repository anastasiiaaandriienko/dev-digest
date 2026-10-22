import type {
  EvalCaseKind,
  EvalCaseOutcome,
  EvalCaseResult,
  EvalCounts,
  EvalExpectation,
  EvalFpReason,
  Finding,
  UnifiedDiff,
} from '@devdigest/shared';
import { groundFindings } from '../../platform/grounding.js';
import { isTooWide, normalizePath, normalizeRange, type LineRange } from './helpers.js';

/**
 * Deterministic eval scorer (specs/eval-pipeline.md §8). A PURE function: no DB,
 * no network, no LLM, no clock, no randomness. Same input (in any order) →
 * identical output, so a stored run can always be re-scored.
 *
 *  - match: same normalized path + inclusive line overlap; findings wider than
 *    EVAL_MAX_SPAN_LINES are never matchable (§8.1, §8.3);
 *  - TP: maximum bipartite matching (Kuhn) expectations × kept findings, so each
 *    expectation and each finding counts at most once (§8.3);
 *  - FP: closed world — every unmatched kept finding, with one reason
 *    too_wide → duplicate → negative_hit → unlabeled (§8.4);
 *  - metrics: micro-averaged; null for a zero denominator, never 0 / 1 (§8.6);
 *  - citation_accuracy: kept + dropped findings judged by the engine's own
 *    grounding gate (§8.6);
 *  - a failed group fails the run: its cases are `error`, run metrics null (§8.7).
 */

export interface ScoredCase {
  id: string;
  name: string;
  kind: EvalCaseKind;
  expected: EvalExpectation;
}

/** One frozen input (cases sharing an `input_hash`) and the engine's output for it. */
export interface ScoringGroup {
  diff: UnifiedDiff;
  cases: readonly ScoredCase[];
  /** `ok`: the engine returned `kept` / `dropped`; `failed`: the engine call failed. */
  status: 'ok' | 'failed';
  kept: readonly Finding[];
  dropped: readonly { finding: Finding; reason: string }[];
}

export type ScoreCounts = Omit<EvalCounts, 'tokens_in' | 'tokens_out'>;

export interface SuiteScore {
  /** Per-case results, ordered by case id. */
  results: EvalCaseResult[];
  counts: ScoreCounts;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  /** True when any group failed: metrics are null (§8.7). */
  failed: boolean;
}

// ---- deterministic ordering ---------------------------------------------------

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** A total order on findings by content (never by input position). */
function findingKey(f: Finding): string {
  return JSON.stringify([
    normalizePath(f.file),
    f.start_line,
    f.end_line,
    f.severity,
    f.category,
    f.kind ?? 'finding',
    f.title,
    f.id,
    f.rationale,
    f.suggestion ?? null,
    f.confidence,
  ]);
}

function compareFindings(a: Finding, b: Finding): number {
  return cmp(findingKey(a), findingKey(b));
}

function compareCases(a: ScoredCase, b: ScoredCase): number {
  return (
    cmp(normalizePath(a.expected.file), normalizePath(b.expected.file)) ||
    cmp(a.expected.start_line, b.expected.start_line) ||
    cmp(a.expected.end_line, b.expected.end_line) ||
    cmp(a.id, b.id)
  );
}

// ---- locations ------------------------------------------------------------------

interface Loc {
  file: string;
  range: LineRange | null;
}

const locOfFinding = (f: Finding): Loc => ({ file: normalizePath(f.file), range: normalizeRange(f.start_line, f.end_line) });
const locOfCase = (c: ScoredCase): Loc => ({
  file: normalizePath(c.expected.file),
  range: normalizeRange(c.expected.start_line, c.expected.end_line),
});

/** Inclusive overlap length (0 = no overlap) on the same normalized path. */
function overlapLength(a: Loc, b: Loc): number {
  if (a.file !== b.file || !a.range || !b.range) return 0;
  const lo = Math.max(a.range.lo, b.range.lo);
  const hi = Math.min(a.range.hi, b.range.hi);
  return hi >= lo ? hi - lo + 1 : 0;
}

/** Findings that may earn a TP: valid range, not wider than EVAL_MAX_SPAN_LINES. */
const isMatchable = (l: Loc): boolean => !!l.range && !isTooWide(l.range);

// ---- maximum bipartite matching (Kuhn) ------------------------------------------

/**
 * Kuhn's augmenting-path algorithm. `adj[e]` lists the finding indexes expectation
 * `e` may take, already in preference order. Returns `matchOfExp[e]` = finding
 * index or -1. The matching size is maximum regardless of preference order; the
 * order only picks WHICH maximum matching (deterministically).
 */
export function maximumMatching(adj: readonly (readonly number[])[], findingCount: number): number[] {
  const matchOfFinding = new Array<number>(findingCount).fill(-1);
  const tryAssign = (e: number, seen: boolean[]): boolean => {
    for (const f of adj[e]!) {
      if (seen[f]) continue;
      seen[f] = true;
      if (matchOfFinding[f] === -1 || tryAssign(matchOfFinding[f]!, seen)) {
        matchOfFinding[f] = e;
        return true;
      }
    }
    return false;
  };
  for (let e = 0; e < adj.length; e++) tryAssign(e, new Array<boolean>(findingCount).fill(false));
  const matchOfExp = new Array<number>(adj.length).fill(-1);
  matchOfFinding.forEach((e, f) => {
    if (e !== -1) matchOfExp[e] = f;
  });
  return matchOfExp;
}

// ---- one group ---------------------------------------------------------------------

interface GroupScore {
  results: EvalCaseResult[];
  tp: number;
  fn: number;
  fpByReason: Record<EvalFpReason, number>;
  kept: number;
  raw: number;
  validCitations: number;
  mustFind: number;
}

const emptyReasons = (): Record<EvalFpReason, number> => ({ too_wide: 0, duplicate: 0, negative_hit: 0, unlabeled: 0 });

function caseResult(
  c: ScoredCase,
  outcome: EvalCaseOutcome,
  extra: Pick<EvalCaseResult, 'matched_finding' | 'overlapping' | 'group_fp' | 'dropped'>,
): EvalCaseResult {
  return {
    case_id: c.id,
    case_name: c.name,
    kind: c.kind,
    outcome,
    pass: outcome === 'tp' || outcome === 'pass',
    expected: c.expected,
    ...extra,
  };
}

/** A raw finding cites real changed lines: valid range AND kept by the engine's grounding gate. */
function hasValidCitation(f: Finding, diff: UnifiedDiff): boolean {
  return !!normalizeRange(f.start_line, f.end_line) && groundFindings([f], diff).kept.length === 1;
}

function scoreGroup(group: ScoringGroup): GroupScore {
  const cases = [...group.cases].sort(compareCases);
  const kept = [...group.kept].sort(compareFindings);
  const dropped = [...group.dropped].sort(
    (a, b) => compareFindings(a.finding, b.finding) || cmp(a.reason, b.reason),
  );

  if (group.status === 'failed') {
    return {
      results: cases.map((c) => caseResult(c, 'error', { matched_finding: null, overlapping: [], group_fp: [], dropped: [] })),
      tp: 0,
      fn: 0,
      fpByReason: emptyReasons(),
      kept: 0,
      raw: 0,
      validCitations: 0,
      mustFind: 0,
    };
  }

  const keptLocs = kept.map(locOfFinding);
  const positives = cases.filter((c) => c.kind === 'must_find');
  const negatives = cases.filter((c) => c.kind === 'must_not_flag');
  const posLocs = positives.map(locOfCase);
  const negLocs = negatives.map(locOfCase);

  // Candidate findings per expectation, in preference order:
  // overlap length desc, |f.lo − e.lo| asc, then the content order of `kept`.
  const adj = posLocs.map((e) =>
    keptLocs
      .map((f, i) => ({ i, f }))
      .filter(({ f }) => isMatchable(f) && overlapLength(f, e) > 0)
      .sort(
        (a, b) =>
          overlapLength(b.f, e) - overlapLength(a.f, e) ||
          Math.abs(a.f.range!.lo - e.range!.lo) - Math.abs(b.f.range!.lo - e.range!.lo) ||
          a.i - b.i,
      )
      .map(({ i }) => i),
  );
  const matchOfExp = maximumMatching(adj, kept.length);
  const matchedFindings = new Set(matchOfExp.filter((f) => f !== -1));
  const matchedPosLocs = posLocs.filter((_, e) => matchOfExp[e] !== -1);

  // Closed world (§8.4): every unmatched kept finding is a false positive.
  const fps: { finding: Finding; reason: EvalFpReason }[] = [];
  const fpByReason = emptyReasons();
  kept.forEach((finding, i) => {
    if (matchedFindings.has(i)) return;
    const loc = keptLocs[i]!;
    let reason: EvalFpReason;
    if (loc.range && isTooWide(loc.range)) reason = 'too_wide';
    else if (matchedPosLocs.some((e) => overlapLength(loc, e) > 0)) reason = 'duplicate';
    else if (negLocs.some((n) => overlapLength(loc, n) > 0)) reason = 'negative_hit';
    else reason = 'unlabeled';
    fps.push({ finding, reason });
    fpByReason[reason]++;
  });

  const overlappingOf = (loc: Loc) => kept.filter((_, i) => overlapLength(keptLocs[i]!, loc) > 0);
  const extra = { group_fp: fps, dropped };
  const resultsByCase = new Map<string, EvalCaseResult>();
  positives.forEach((c, e) => {
    const f = matchOfExp[e]!;
    resultsByCase.set(
      c.id,
      caseResult(c, f !== -1 ? 'tp' : 'fn', { matched_finding: f !== -1 ? kept[f]! : null, overlapping: overlappingOf(posLocs[e]!), ...extra }),
    );
  });
  negatives.forEach((c, n) => {
    const overlapping = overlappingOf(negLocs[n]!);
    resultsByCase.set(c.id, caseResult(c, overlapping.length === 0 ? 'pass' : 'fail', { matched_finding: null, overlapping, ...extra }));
  });

  const raw = [...kept, ...dropped.map((d) => d.finding)];
  const tp = matchedFindings.size;
  return {
    results: cases.map((c) => resultsByCase.get(c.id)!),
    tp,
    fn: positives.length - tp,
    fpByReason,
    kept: kept.length,
    raw: raw.length,
    validCitations: raw.filter((f) => hasValidCitation(f, group.diff)).length,
    mustFind: positives.length,
  };
}

// ---- the run -------------------------------------------------------------------------

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

export function scoreSuite(groups: readonly ScoringGroup[]): SuiteScore {
  const scored = groups.map(scoreGroup);
  const sum = (pick: (g: GroupScore) => number) => scored.reduce((n, g) => n + pick(g), 0);
  const fpByReason = emptyReasons();
  for (const g of scored) for (const r of Object.keys(fpByReason) as EvalFpReason[]) fpByReason[r] += g.fpByReason[r];

  const results = scored.flatMap((g) => g.results).sort((a, b) => cmp(a.case_id, b.case_id));
  const tp = sum((g) => g.tp);
  const fn = sum((g) => g.fn);
  const kept = sum((g) => g.kept);
  const raw = sum((g) => g.raw);
  const validCitations = sum((g) => g.validCitations);
  const counts: ScoreCounts = {
    cases_total: results.length,
    cases_passed: results.filter((r) => r.pass).length,
    tp,
    fn,
    fp: kept - tp,
    fp_by_reason: fpByReason,
    kept,
    raw,
    valid_citations: validCitations,
  };
  const failed = groups.some((g) => g.status === 'failed');
  return {
    results,
    counts,
    recall: failed || sum((g) => g.mustFind) === 0 ? null : ratio(tp, tp + fn),
    precision: failed ? null : ratio(tp, kept),
    citation_accuracy: failed ? null : ratio(validCitations, raw),
    failed,
  };
}
