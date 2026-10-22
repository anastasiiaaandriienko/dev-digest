import { describe, it, expect } from 'vitest';
import type { EvalCaseKind, Finding, UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { EVAL_MAX_SPAN_LINES } from '../src/modules/evals/constants.js';
import { maximumMatching, scoreSuite, type ScoredCase, type ScoringGroup } from '../src/modules/evals/scoring.js';

/**
 * Deterministic scorer (specs/eval-pipeline.md §8; ACs 14-20, 35). Pure unit
 * tests: no DB, no network, no LLM.
 */

/** A diff where `file` gains lines 1..n (all new-side lines are hunk lines). */
function addedFileDiff(files: Record<string, number>): UnifiedDiff {
  const parts: string[] = [];
  for (const [file, n] of Object.entries(files)) {
    parts.push(`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -0,0 +1,${n} @@`);
    for (let i = 1; i <= n; i++) parts.push(`+line ${i}`);
  }
  return parseUnifiedDiff(parts.join('\n'));
}

const DIFF = addedFileDiff({ 'src/a.ts': 120, 'src/b.ts': 40 });

let seq = 0;
function f(file: string, start: number, end = start, over: Partial<Finding> = {}): Finding {
  seq++;
  return {
    id: `f${String(seq).padStart(3, '0')}`,
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${seq}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
    ...over,
  };
}

function c(id: string, kind: EvalCaseKind, file: string, start: number, end = start): ScoredCase {
  return {
    id,
    name: id,
    kind,
    expected: { kind, file, start_line: start, end_line: end, severity: 'WARNING', category: 'bug', title: id },
  };
}

function group(
  cases: ScoredCase[],
  kept: Finding[],
  dropped: { finding: Finding; reason: string }[] = [],
  diff: UnifiedDiff = DIFF,
): ScoringGroup {
  return { diff, cases, status: 'ok', kept, dropped };
}

const outcomeOf = (s: ReturnType<typeof scoreSuite>, id: string) => s.results.find((r) => r.case_id === id)!.outcome;

// ---------------------------------------------------------------------------

describe('matching: path + inclusive line overlap (§8.1, AC-14)', () => {
  it('matches on normalized path and any overlapping line', () => {
    const s = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 10, 12)], [f('./src/a.ts', 12, 14)])]);
    expect(s.counts.tp).toBe(1);
    expect(outcomeOf(s, 'p1')).toBe('tp');
  });

  it('has zero tolerance: an adjacent line or another file does not match', () => {
    const s = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 10, 12)], [f('src/a.ts', 13), f('src/b.ts', 10)])]);
    expect(s.counts.tp).toBe(0);
    expect(s.counts.fn).toBe(1);
    expect(s.counts.fp_by_reason.unlabeled).toBe(2);
  });

  it('ignores severity / category / title when matching', () => {
    const s = scoreSuite([
      group([c('p1', 'must_find', 'src/a.ts', 5)], [f('src/a.ts', 5, 5, { severity: 'SUGGESTION', category: 'style', title: 'other' })]),
    ]);
    expect(s.counts.tp).toBe(1);
  });
});

describe('maximum matching vs greedy (§8.3, AC-15)', () => {
  // E1 = a.ts:1-5, E2 = a.ts:6-10 (non-overlapping, as creation enforces).
  // F1 = a.ts:3-6 overlaps E1 by 3 lines and E2 by 1 line; F2 = a.ts:5 overlaps E1 only.
  const cases = [c('e1', 'must_find', 'src/a.ts', 1, 5), c('e2', 'must_find', 'src/a.ts', 6, 10)];
  const f1 = f('src/a.ts', 3, 6);
  const f2 = f('src/a.ts', 5, 5);

  /** What a greedy "best overlap first" scorer would do. */
  function greedyTp(): number {
    const used = new Set<Finding>();
    let tp = 0;
    for (const e of cases) {
      const cand = [f1, f2]
        .filter((x) => !used.has(x))
        .map((x) => ({ x, ov: Math.min(x.end_line, e.expected.end_line) - Math.max(x.start_line, e.expected.start_line) + 1 }))
        .filter((o) => o.ov > 0)
        .sort((a, b) => b.ov - a.ov);
      if (cand[0]) {
        used.add(cand[0].x);
        tp++;
      }
    }
    return tp;
  }

  it('greedy finds only 1 TP here …', () => {
    expect(greedyTp()).toBe(1);
  });

  it('… the scorer finds the maximum, 2 TP (E1←F2, E2←F1)', () => {
    const s = scoreSuite([group(cases, [f1, f2])]);
    expect(s.counts.tp).toBe(2);
    expect(s.counts.fp).toBe(0);
    expect(s.results.find((r) => r.case_id === 'e1')!.matched_finding!.id).toBe(f2.id);
    expect(s.results.find((r) => r.case_id === 'e2')!.matched_finding!.id).toBe(f1.id);
  });

  it('maximumMatching never assigns a finding twice', () => {
    expect(maximumMatching([[0], [0], [0, 1]], 2).filter((x) => x !== -1).sort()).toEqual([0, 1]);
  });
});

describe('false positives — closed world, FP = kept − TP (§8.4)', () => {
  it('duplicates never raise TP and lower precision (AC-16)', () => {
    const one = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 5)], [f('src/a.ts', 5)])]);
    const three = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 5)], [f('src/a.ts', 5), f('src/a.ts', 5), f('src/a.ts', 4, 6)])]);
    expect(one.counts.tp).toBe(1);
    expect(one.precision).toBe(1);
    expect(three.counts.tp).toBe(1);
    expect(three.counts.fp_by_reason.duplicate).toBe(2);
    expect(three.precision).toBeCloseTo(1 / 3);
  });

  it('a finding on a dismissed location is FP negative_hit and fails the case (AC-17)', () => {
    const s = scoreSuite([group([c('n1', 'must_not_flag', 'src/a.ts', 20)], [f('src/a.ts', 19, 21)])]);
    expect(s.counts.fp_by_reason.negative_hit).toBe(1);
    expect(outcomeOf(s, 'n1')).toBe('fail');
    expect(s.precision).toBe(0);
  });

  it('counts one FP per finding: two findings on one negative = 2, one finding on two negatives = 1', () => {
    const two = scoreSuite([group([c('n1', 'must_not_flag', 'src/a.ts', 20)], [f('src/a.ts', 20), f('src/a.ts', 20)])]);
    expect(two.counts.fp_by_reason.negative_hit).toBe(2);
    const spanning = scoreSuite([
      group([c('n1', 'must_not_flag', 'src/a.ts', 20), c('n2', 'must_not_flag', 'src/a.ts', 22)], [f('src/a.ts', 20, 22)]),
    ]);
    expect(spanning.counts.fp).toBe(1);
    expect(outcomeOf(spanning, 'n1')).toBe('fail');
    expect(outcomeOf(spanning, 'n2')).toBe('fail');
  });

  it('extra unlabeled findings lower precision (AC-18)', () => {
    const cases = [c('p1', 'must_find', 'src/a.ts', 5)];
    const clean = scoreSuite([group(cases, [f('src/a.ts', 5)])]);
    const noisy = scoreSuite([group(cases, [f('src/a.ts', 5), f('src/a.ts', 60), f('src/b.ts', 1), f('src/b.ts', 30)])]);
    expect(clean.precision).toBe(1);
    expect(noisy.counts.fp_by_reason.unlabeled).toBe(3);
    expect(noisy.precision).toBe(0.25);
    expect(noisy.counts.fp).toBe(noisy.counts.kept - noisy.counts.tp);
  });

  it('a matched finding that also touches a negative stays TP (no double count) but fails the negative', () => {
    const s = scoreSuite([
      group([c('p1', 'must_find', 'src/a.ts', 10), c('n1', 'must_not_flag', 'src/a.ts', 11)], [f('src/a.ts', 10, 11)]),
    ]);
    expect(s.counts.tp).toBe(1);
    expect(s.counts.fp).toBe(0);
    expect(outcomeOf(s, 'n1')).toBe('fail');
  });
});

describe('too-wide findings (EVAL_MAX_SPAN_LINES, AC-35)', () => {
  it('a whole-file range cannot earn a TP and is FP too_wide', () => {
    const s = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 30)], [f('src/a.ts', 1, 120)])]);
    expect(s.counts.tp).toBe(0);
    expect(s.counts.fn).toBe(1);
    expect(s.counts.fp_by_reason.too_wide).toBe(1);
    expect(s.recall).toBe(0);
    expect(s.precision).toBe(0);
  });

  it('uses the inclusive limit exactly: 50 lines match, 51 do not', () => {
    const cases = [c('p1', 'must_find', 'src/a.ts', 30)];
    expect(scoreSuite([group(cases, [f('src/a.ts', 1, EVAL_MAX_SPAN_LINES)])]).counts.tp).toBe(1);
    expect(scoreSuite([group(cases, [f('src/a.ts', 1, EVAL_MAX_SPAN_LINES + 1)])]).counts.tp).toBe(0);
  });

  it('a too-wide finding over a dismissed location still fails that case', () => {
    const s = scoreSuite([group([c('n1', 'must_not_flag', 'src/a.ts', 70)], [f('src/a.ts', 1, 100)])]);
    expect(outcomeOf(s, 'n1')).toBe('fail');
    expect(s.counts.fp_by_reason.too_wide).toBe(1);
  });
});

describe('metrics and zero denominators (§8.6, AC-19)', () => {
  it('an empty output never yields 100 % precision', () => {
    const s = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 5), c('n1', 'must_not_flag', 'src/a.ts', 9)], [])]);
    expect(s.recall).toBe(0);
    expect(s.precision).toBeNull();
    expect(s.citation_accuracy).toBeNull();
    expect(outcomeOf(s, 'n1')).toBe('pass');
    expect(s.counts.cases_passed).toBe(1);
  });

  it('recall is null without must_find cases', () => {
    const s = scoreSuite([group([c('n1', 'must_not_flag', 'src/a.ts', 9)], [f('src/a.ts', 30)])]);
    expect(s.recall).toBeNull();
    expect(s.precision).toBe(0);
  });

  it('micro-averages over input groups', () => {
    const s = scoreSuite([
      group([c('p1', 'must_find', 'src/a.ts', 5), c('p2', 'must_find', 'src/a.ts', 50)], [f('src/a.ts', 5)]),
      group([c('p3', 'must_find', 'src/b.ts', 3)], [f('src/b.ts', 3), f('src/b.ts', 20)]),
    ]);
    expect(s.counts).toMatchObject({ tp: 2, fn: 1, fp: 1, kept: 3, cases_total: 3, cases_passed: 2 });
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.precision).toBeCloseTo(2 / 3);
  });
});

describe('citation_accuracy uses the grounding gate on kept + dropped (§8.6)', () => {
  it('a hallucinated (dropped) location lowers citation accuracy', () => {
    const kept = [f('src/a.ts', 5)];
    const dropped = [{ finding: f('src/a.ts', 500), reason: 'no hunk' }, { finding: f('src/zzz.ts', 1), reason: 'no file' }];
    const s = scoreSuite([group([c('p1', 'must_find', 'src/a.ts', 5)], kept, dropped)]);
    expect(s.counts).toMatchObject({ raw: 3, valid_citations: 1 });
    expect(s.citation_accuracy).toBeCloseTo(1 / 3);
    expect(s.precision).toBe(1); // dropped findings never reach precision
  });

  it('an invalid line (0) is an invalid citation', () => {
    const s = scoreSuite([group([], [], [{ finding: f('src/a.ts', 0, 0), reason: 'bad' }])]);
    expect(s.citation_accuracy).toBe(0);
  });

  it('full-file kinds only need the file in the diff', () => {
    const s = scoreSuite([group([], [], [{ finding: f('src/a.ts', 999, 999, { kind: 'secret_leak' }), reason: 'x' }])]);
    expect(s.citation_accuracy).toBe(1);
  });
});

describe('§8.4 example — closed-world precision falls when noise grows', () => {
  // gold set: 6 must_find (a.ts:10,20,…,60) + 3 must_not_flag (b.ts:5,15,25)
  const cases = [
    ...[10, 20, 30, 40, 50, 60].map((l, i) => c(`p${i + 1}`, 'must_find', 'src/a.ts', l)),
    ...[5, 15, 25].map((l, i) => c(`n${i + 1}`, 'must_not_flag', 'src/b.ts', l)),
  ];
  const noise = (n: number) => Array.from({ length: n }, (_, i) => f('src/a.ts', 70 + i));

  it('v1 (focused): 5 TP, 1 negative hit, 1 unlabeled → P 0.71, R 0.83', () => {
    const kept = [...[10, 20, 30, 40, 50].map((l) => f('src/a.ts', l)), f('src/b.ts', 5), ...noise(1)];
    const s = scoreSuite([group(cases, kept)]);
    expect(s.counts).toMatchObject({ kept: 7, tp: 5, fp: 2, fp_by_reason: { negative_hit: 1, unlabeled: 1, duplicate: 0, too_wide: 0 } });
    expect(s.precision).toBeCloseTo(5 / 7);
    expect(s.recall).toBeCloseTo(5 / 6);
  });

  it('v2 ("report every possible issue"): 6 TP, 1 negative hit, 13 unlabeled → P 0.30, R 1.00', () => {
    const kept = [...[10, 20, 30, 40, 50, 60].map((l) => f('src/a.ts', l)), f('src/b.ts', 5), ...noise(13)];
    const s = scoreSuite([group(cases, kept)]);
    expect(s.counts).toMatchObject({ kept: 20, tp: 6, fp: 14 });
    expect(s.precision).toBeCloseTo(0.3);
    expect(s.recall).toBe(1);
    // the rejected open-world variant would have reported TP/(TP+negative_hit) = 6/7 ≈ 0.86 here
    expect(s.counts.tp / (s.counts.tp + s.counts.fp_by_reason.negative_hit)).toBeCloseTo(6 / 7);
  });
});

describe('failed groups (§8.7)', () => {
  it('marks the failed group cases error, keeps the others, and nulls run metrics', () => {
    const ok = group([c('p1', 'must_find', 'src/a.ts', 5)], [f('src/a.ts', 5)]);
    const failed: ScoringGroup = { diff: DIFF, cases: [c('p2', 'must_find', 'src/b.ts', 3)], status: 'failed', kept: [], dropped: [] };
    const s = scoreSuite([ok, failed]);
    expect(s.failed).toBe(true);
    expect([s.recall, s.precision, s.citation_accuracy]).toEqual([null, null, null]);
    expect(outcomeOf(s, 'p1')).toBe('tp');
    expect(outcomeOf(s, 'p2')).toBe('error');
    expect(s.counts.cases_passed).toBe(1);
  });
});

describe('determinism (AC-20)', () => {
  function shuffled<T>(xs: readonly T[], seed: number): T[] {
    const a = [...xs];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  const g1 = group(
    [c('p1', 'must_find', 'src/a.ts', 1, 5), c('p2', 'must_find', 'src/a.ts', 6, 10), c('n1', 'must_not_flag', 'src/a.ts', 30)],
    [f('src/a.ts', 3, 6), f('src/a.ts', 5), f('src/a.ts', 5), f('src/a.ts', 30), f('src/a.ts', 1, 90), f('src/a.ts', 44)],
    [{ finding: f('src/a.ts', 400), reason: 'x' }],
  );
  const g2 = group([c('p3', 'must_find', 'src/b.ts', 2)], [f('src/b.ts', 2), f('src/b.ts', 9)]);

  it('input order (groups, cases, kept, dropped) does not change the result', () => {
    const base = scoreSuite([g1, g2]);
    for (let seed = 1; seed <= 20; seed++) {
      const perm = shuffled([g1, g2], seed).map((g) => ({
        ...g,
        cases: shuffled(g.cases, seed + 1),
        kept: shuffled(g.kept, seed + 2),
        dropped: shuffled(g.dropped, seed + 3),
      }));
      expect(scoreSuite(perm)).toEqual(base);
    }
  });

  it('re-scoring stored (JSON round-tripped) input gives the identical result', () => {
    const base = scoreSuite([g1, g2]);
    const stored = JSON.parse(JSON.stringify([g1, g2])) as ScoringGroup[];
    expect(scoreSuite(stored)).toEqual(base);
  });

  it('does not mutate its input', () => {
    const before = JSON.stringify([g1, g2]);
    scoreSuite([g1, g2]);
    expect(JSON.stringify([g1, g2])).toBe(before);
  });
});
