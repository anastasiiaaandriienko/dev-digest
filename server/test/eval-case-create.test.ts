import { describe, it, expect } from 'vitest';
import type { EvalExpectation, UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import type { EvalCaseRow, FindingRow, PullRow } from '../src/db/rows.js';
import type { ReviewRow } from '../src/modules/reviews/repository.js';
import type { Container } from '../src/platform/container.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';
import { EVAL_MAX_DIFF_CHARS, EVAL_MAX_SPAN_LINES } from '../src/modules/evals/constants.js';
import {
  computeInputHash,
  defaultCaseName,
  findLocationConflict,
  isTooWide,
  labelFromDecision,
  locationInDiff,
  locationsOverlap,
  normalizePath,
  normalizeRange,
  uniqueCaseName,
} from '../src/modules/evals/helpers.js';
import type { EvalCaseLockedState } from '../src/modules/evals/repository.js';
import { EvalService, type EvalFindingSource, type EvalStore } from '../src/modules/evals/service.js';

/**
 * Eval case creation from a decided finding (specs/eval-pipeline.md §7, ACs
 * 01-08) — pure helpers + EvalService with in-memory fakes. No DB, no LLM.
 * The real transaction / lock / unique index are covered by evals.it.test.ts.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

const RAW_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,4 @@',
  ' const a = 1;',
  '+const b = 2;',
  '+const c = 3;',
  ' export { a };',
].join('\n');
const DIFF: UnifiedDiff = parseUnifiedDiff(RAW_DIFF);

// ---- helpers ------------------------------------------------------------------

describe('normalizePath / normalizeRange / overlap (spec §8.1)', () => {
  it('normalizes separators and leading ./ or / but keeps case and a/ b/ dirs', () => {
    expect(normalizePath(' ./src\\a.ts ')).toBe('src/a.ts');
    expect(normalizePath('/src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('././x.ts')).toBe('x.ts');
    expect(normalizePath('a/b.ts')).toBe('a/b.ts');
    expect(normalizePath('Src/A.ts')).toBe('Src/A.ts');
  });

  it('orders a range and rejects non-integer or < 1 lines', () => {
    expect(normalizeRange(5, 3)).toEqual({ lo: 3, hi: 5 });
    expect(normalizeRange(0, 3)).toBeNull();
    expect(normalizeRange(1.5, 3)).toBeNull();
  });

  it('overlaps inclusively on the same normalized path only', () => {
    const at = (file: string, s: number, e: number) => ({ file, start_line: s, end_line: e });
    expect(locationsOverlap(at('src/a.ts', 1, 3), at('./src/a.ts', 3, 9))).toBe(true);
    expect(locationsOverlap(at('src/a.ts', 1, 3), at('src/a.ts', 4, 9))).toBe(false);
    expect(locationsOverlap(at('src/a.ts', 1, 3), at('src/b.ts', 1, 3))).toBe(false);
  });

  it('uses EVAL_MAX_SPAN_LINES as the inclusive width limit', () => {
    expect(isTooWide({ lo: 1, hi: EVAL_MAX_SPAN_LINES })).toBe(false);
    expect(isTooWide({ lo: 1, hi: EVAL_MAX_SPAN_LINES + 1 })).toBe(true);
  });
});

describe('locationInDiff (same rule as the grounding gate)', () => {
  const exp = { file: 'src/a.ts', start_line: 2, end_line: 2, severity: 'WARNING', category: 'bug', title: 't' } as const;
  it('accepts a range on new-side hunk lines and rejects one outside', () => {
    expect(locationInDiff(exp, 'finding', DIFF)).toBe(true);
    expect(locationInDiff({ ...exp, start_line: 40, end_line: 41 }, 'finding', DIFF)).toBe(false);
    expect(locationInDiff({ ...exp, file: 'src/other.ts' }, 'finding', DIFF)).toBe(false);
  });
  it('lets full-file kinds pass when the file is in the diff', () => {
    expect(locationInDiff({ ...exp, start_line: 40, end_line: 41 }, 'secret_leak', DIFF)).toBe(true);
  });
});

describe('labelFromDecision', () => {
  it('maps accepted → must_find, dismissed → must_not_flag, none → null', () => {
    expect(labelFromDecision({ acceptedAt: new Date(), dismissedAt: null })).toBe('must_find');
    expect(labelFromDecision({ acceptedAt: null, dismissedAt: new Date() })).toBe('must_not_flag');
    expect(labelFromDecision({ acceptedAt: null, dismissedAt: null })).toBeNull();
  });
});

describe('case names', () => {
  it('builds kebab-case defaults like the design seed', () => {
    expect(defaultCaseName('must_find', 'Hardcoded Stripe secret key!')).toBe('must-find-hardcoded-stripe-secret-key');
    expect(defaultCaseName('must_not_flag', 'Unused import')).toBe('no-unused-import');
    expect(defaultCaseName('must_find', '!!!')).toBe('must-find-finding');
  });
  it('de-duplicates with -2, -3 and stays within 80 chars', () => {
    expect(uniqueCaseName('x', new Set())).toBe('x');
    expect(uniqueCaseName('x', new Set(['x', 'x-2']))).toBe('x-3');
    const long = 'a'.repeat(90);
    const taken = new Set([long.slice(0, 80)]);
    const name = uniqueCaseName(long, taken);
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith('-2')).toBe(true);
  });
});

describe('computeInputHash', () => {
  it('is stable and changes with diff, title or body', () => {
    const h = computeInputHash('d', 't', null);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeInputHash('d', 't', null)).toBe(h);
    expect(computeInputHash('d', 't', '')).toBe(h); // null body == empty body
    expect(computeInputHash('d2', 't', null)).not.toBe(h);
    expect(computeInputHash('d', 't2', null)).not.toBe(h);
    expect(computeInputHash('d', 't', 'b')).not.toBe(h);
  });
});

describe('findLocationConflict (spec §7.5)', () => {
  const exp: EvalExpectation = {
    kind: 'must_find',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 3,
    severity: 'WARNING',
    category: 'bug',
    title: 't',
  };
  const row = (id: string, kind: 'must_find' | 'must_not_flag' | null, s: number, e: number) =>
    ({ id, kind, expectedOutput: { ...exp, kind: kind ?? 'must_find', start_line: s, end_line: e } }) as EvalCaseRow;

  it('reports a same-kind overlap as duplicate_location (wins over a conflict)', () => {
    expect(findLocationConflict(exp, [row('n', 'must_not_flag', 3, 3), row('p', 'must_find', 1, 2)])).toEqual({
      code: 'duplicate_location',
      caseId: 'p',
    });
  });
  it('reports an opposite-kind overlap as conflicting_label', () => {
    expect(findLocationConflict(exp, [row('n', 'must_not_flag', 3, 4)])).toEqual({ code: 'conflicting_label', caseId: 'n' });
  });
  it('ignores non-overlapping and legacy rows', () => {
    expect(findLocationConflict(exp, [row('x', 'must_find', 4, 5), row('l', null, 2, 3)])).toBeNull();
  });
});

// ---- EvalService.createFromFinding ---------------------------------------------

function findingRow(over: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'finding-1',
    reviewId: 'review-1',
    file: './src/a.ts',
    startLine: 3,
    endLine: 2,
    severity: 'WARNING',
    category: 'bug',
    title: 'Unused constant',
    rationale: 'r',
    suggestion: null,
    confidence: 0.8,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: new Date('2026-10-22T09:00:00.000Z'),
    dismissedAt: null,
    ...over,
  } as FindingRow;
}

const review = { id: 'review-1', agentId: AGENT, runId: 'run-1', workspaceId: WS } as ReviewRow;
const pull = {
  id: 'pr-1',
  workspaceId: WS,
  repoId: 'repo-1',
  number: 3,
  title: 'Add constants',
  body: 'Body',
  base: 'main',
  headSha: 'abc',
} as PullRow;

function setup(opts: { finding?: FindingRow; reviewOver?: Partial<ReviewRow>; diff?: UnifiedDiff | null; state?: Partial<EvalCaseLockedState> } = {}) {
  const inserted: unknown[] = [];
  const store: EvalStore = {
    getAgent: async (ws, id) => (ws === WS && id === AGENT ? { id, version: 4 } : undefined),
    listAgentEvalCases: async () => [],
    listLastCaseResults: async () => [],
    listAgentEvalRuns: async () => [],
    agentVersionOfRun: async (runId) => (runId === 'run-1' ? 3 : null),
    createCaseLocked: async (_scope, build) => {
      const values = build({ existing: undefined, sameInput: [], takenNames: new Set(), ...opts.state });
      inserted.push(values);
      return { id: 'case-new', ...values } as EvalCaseRow;
    },
  };
  const source: EvalFindingSource = {
    findingContext: async (id) =>
      id === 'finding-1' ? { finding: opts.finding ?? findingRow(), review: { ...review, ...opts.reviewOver }, pull } : undefined,
    loadPullDiff: async () => (opts.diff === null ? null : { diff: opts.diff ?? DIFF, repo: 'acme/app' }),
  };
  return { service: new EvalService({} as Container, { store, source }), inserted };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof AppError ? `${err.statusCode}:${err.code}` : String(err);
  }
}

describe('EvalService.createFromFinding', () => {
  it('freezes diff, PR meta, normalized location, hash and provenance (accepted → must_find)', async () => {
    const { service, inserted } = setup();
    const dto = await service.createFromFinding(WS, 'finding-1', {});
    expect(dto.kind).toBe('must_find');
    expect(dto.expected).toEqual({
      kind: 'must_find',
      file: 'src/a.ts',
      start_line: 2,
      end_line: 3,
      severity: 'WARNING',
      category: 'bug',
      title: 'Unused constant',
    });
    expect(dto.name).toBe('must-find-unused-constant');
    expect(dto.source_finding_id).toBe('finding-1');
    expect(dto.input_hash).toBe(computeInputHash(DIFF.raw, 'Add constants', 'Body'));
    expect(dto.meta).toMatchObject({
      pr_number: 3,
      pr_title: 'Add constants',
      pr_body: 'Body',
      repo: 'acme/app',
      head_sha: 'abc',
      source_review_id: 'review-1',
      source_agent_id: AGENT,
      source_agent_version: 3,
      decided_at: '2026-10-22T09:00:00.000Z',
      diff_stats: { files: 1, additions: 2, deletions: 0 },
    });
    expect(inserted[0]).toMatchObject({ inputDiff: DIFF.raw, ownerKind: 'agent', ownerId: AGENT, workspaceId: WS });
  });

  it('labels a dismissed finding must_not_flag with a no-… name', async () => {
    const { service } = setup({ finding: findingRow({ acceptedAt: null, dismissedAt: new Date() }) });
    const dto = await service.createFromFinding(WS, 'finding-1', { name: 'my-case', notes: 'n' });
    expect(dto.kind).toBe('must_not_flag');
    expect(dto.name).toBe('my-case');
    expect(dto.notes).toBe('n');
  });

  it('404s for an unknown finding or one of another workspace', async () => {
    expect(await codeOf(setup().service.createFromFinding(WS, 'nope', {}))).toBe('404:not_found');
    await expect(setup().service.createFromFinding(OTHER_WS, 'finding-1', {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an undecided finding (409 finding_not_decided)', async () => {
    const { service } = setup({ finding: findingRow({ acceptedAt: null, dismissedAt: null }) });
    expect(await codeOf(service.createFromFinding(WS, 'finding-1', {}))).toBe('409:finding_not_decided');
  });

  it('rejects a finding without (a workspace) agent (422 finding_has_no_agent)', async () => {
    expect(await codeOf(setup({ reviewOver: { agentId: null } }).service.createFromFinding(WS, 'finding-1', {}))).toBe(
      '422:finding_has_no_agent',
    );
    expect(
      await codeOf(setup({ reviewOver: { agentId: OTHER_WS } }).service.createFromFinding(WS, 'finding-1', {})),
    ).toBe('422:finding_has_no_agent');
  });

  it('rejects a range wider than EVAL_MAX_SPAN_LINES (422 range_too_wide)', async () => {
    const { service } = setup({ finding: findingRow({ startLine: 1, endLine: EVAL_MAX_SPAN_LINES + 1 }) });
    expect(await codeOf(service.createFromFinding(WS, 'finding-1', {}))).toBe('422:range_too_wide');
  });

  it('rejects a location outside the diff and invalid lines (422 location_not_in_diff)', async () => {
    expect(
      await codeOf(setup({ finding: findingRow({ startLine: 30, endLine: 31 }) }).service.createFromFinding(WS, 'finding-1', {})),
    ).toBe('422:location_not_in_diff');
    expect(
      await codeOf(setup({ finding: findingRow({ startLine: 0, endLine: 0 }) }).service.createFromFinding(WS, 'finding-1', {})),
    ).toBe('422:location_not_in_diff');
  });

  it('rejects an unavailable / empty diff (422) and a too-large diff (413)', async () => {
    expect(await codeOf(setup({ diff: null }).service.createFromFinding(WS, 'finding-1', {}))).toBe('422:diff_unavailable');
    expect(
      await codeOf(setup({ diff: parseUnifiedDiff('') }).service.createFromFinding(WS, 'finding-1', {})),
    ).toBe('422:diff_unavailable');
    const huge = { ...DIFF, raw: DIFF.raw + ' '.repeat(EVAL_MAX_DIFF_CHARS) };
    expect(await codeOf(setup({ diff: huge }).service.createFromFinding(WS, 'finding-1', {}))).toBe('413:diff_too_large');
  });

  it('maps the locked-state checks to eval_case_exists / duplicate_location / conflicting_label', async () => {
    const other = (kind: 'must_find' | 'must_not_flag') =>
      ({
        id: 'case-old',
        kind,
        expectedOutput: { kind, file: 'src/a.ts', start_line: 3, end_line: 3, severity: 'WARNING', category: 'bug', title: 'x' },
      }) as EvalCaseRow;
    const exists = setup({ state: { existing: { id: 'case-old' } as EvalCaseRow } });
    expect(await codeOf(exists.service.createFromFinding(WS, 'finding-1', {}))).toBe('409:eval_case_exists');
    const dup = setup({ state: { sameInput: [other('must_find')] } });
    expect(await codeOf(dup.service.createFromFinding(WS, 'finding-1', {}))).toBe('409:duplicate_location');
    const conflict = setup({ state: { sameInput: [other('must_not_flag')] } });
    expect(await codeOf(conflict.service.createFromFinding(WS, 'finding-1', {}))).toBe('409:conflicting_label');
    expect(exists.inserted).toHaveLength(0);
  });

  it('de-duplicates the name against names the agent already uses', async () => {
    const { service } = setup({ state: { takenNames: new Set(['must-find-unused-constant']) } });
    expect((await service.createFromFinding(WS, 'finding-1', {})).name).toBe('must-find-unused-constant-2');
  });

  it('maps a unique-index race (23505) to 409 eval_case_exists', async () => {
    const { service } = setup();
    (service as unknown as { store: EvalStore }).store.createCaseLocked = async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    };
    expect(await codeOf(service.createFromFinding(WS, 'finding-1', {}))).toBe('409:eval_case_exists');
  });
});
