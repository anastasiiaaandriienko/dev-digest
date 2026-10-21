// Pure unit tests: no network, no DB, no LLM.
import { describe, it, expect } from 'vitest';
import type { PrBrief } from '@devdigest/shared';
import { evaluateBriefFreshness, toStoredIntent, validateBriefOutput } from '../src/modules/brief/helpers.js';
import type { BriefGeneration } from '../src/modules/brief/prompt.js';
import { BRIEF_PROMPT_VERSION } from '../src/modules/brief/constants.js';

const CHANGED = ['src/a.ts', 'src/b.ts'];

const gen = (over: Partial<BriefGeneration> = {}): BriefGeneration => ({
  summary: ' Why. ',
  risks: [],
  review_focus: [],
  ...over,
});

const risk = (title: string, file_refs: string[] = []): BriefGeneration['risks'][number] => ({
  kind: 'k',
  title,
  explanation: 'e',
  severity: 'medium',
  file_refs,
});

const focus = (path: string, line: number) => ({ path, line, reason: 'r' });

describe('validateBriefOutput', () => {
  it('AC-BRIEF-09 drops focus on non-changed path', () => {
    const out = validateBriefOutput(
      gen({ review_focus: [focus('src/a.ts', 3), focus('src/missing.ts', 1), focus('../etc/passwd', 1)] }),
      CHANGED,
    );
    expect(out.review_focus).toEqual([{ path: 'src/a.ts', line: 3, reason: 'r' }]);
  });

  it('AC-BRIEF-10 drops invalid file_refs', () => {
    const out = validateBriefOutput(
      gen({
        risks: [
          risk('t', [
            'src/a.ts',
            'src/a.ts:12',
            'src/b.ts:0',
            'src/b.ts:1.5',
            'src/b.ts:abc',
            'src/b.ts:12:3',
            'src/missing.ts',
            'src/missing.ts:4',
            'src/a.ts:-2',
            '',
          ]),
        ],
      }),
      CHANGED,
    );
    expect(out.risks[0]!.file_refs).toEqual(['src/a.ts', 'src/a.ts:12']);
  });

  it('AC-BRIEF-11 drops non-integer/<1 lines', () => {
    const out = validateBriefOutput(
      gen({
        review_focus: [
          focus('src/a.ts', 0),
          focus('src/a.ts', -3),
          focus('src/a.ts', 2.5),
          focus('src/a.ts', Number.NaN),
          focus('src/a.ts', Number.POSITIVE_INFINITY),
          focus('src/a.ts', 1),
        ],
      }),
      CHANGED,
    );
    expect(out.review_focus.map((f) => f.line)).toEqual([1]);
  });

  it('AC-BRIEF-12 keeps first 8 focus', () => {
    const items = Array.from({ length: 12 }, (_, i) => focus(i % 2 ? 'src/a.ts' : 'src/b.ts', i + 1));
    const out = validateBriefOutput(gen({ review_focus: items }), CHANGED);
    expect(out.review_focus).toHaveLength(8);
    expect(out.review_focus.map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('AC-BRIEF-12 invalid items do not count toward the 8', () => {
    const items = [...Array.from({ length: 5 }, () => focus('nope.ts', 1)), ...Array.from({ length: 9 }, (_, i) => focus('src/a.ts', i + 1))];
    const out = validateBriefOutput(gen({ review_focus: items }), CHANGED);
    expect(out.review_focus.map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('AC-BRIEF-47 keeps first 6 risks', () => {
    const risks = Array.from({ length: 9 }, (_, i) => risk(`risk ${i}`));
    const out = validateBriefOutput(gen({ risks }), CHANGED);
    expect(out.risks.map((r) => r.title)).toEqual(['risk 0', 'risk 1', 'risk 2', 'risk 3', 'risk 4', 'risk 5']);
  });

  it('trims and bounds strings', () => {
    const out = validateBriefOutput(gen({ summary: `  ${'s'.repeat(5000)}  `, risks: [risk(`  ${'t'.repeat(5000)} `)] }), CHANGED);
    expect(out.summary.length).toBeLessThanOrEqual(1200);
    expect(out.risks[0]!.title.length).toBeLessThanOrEqual(600);
    expect(out.risks[0]!.title.startsWith('t')).toBe(true);
  });
});

const brief = (meta: Partial<NonNullable<PrBrief['meta']>> = {}, withMeta = true): PrBrief => ({
  intent: { intent: '', in_scope: [], out_of_scope: [] },
  blast: { changed_symbols: [], downstream: [], summary: '' },
  risks: { risks: [] },
  ...(withMeta
    ? {
        meta: {
          head_sha: 'h1',
          provider: 'openai',
          model: 'm1',
          prompt_version: BRIEF_PROMPT_VERSION,
          tokens_in: 1,
          tokens_out: 1,
          attempts: 1,
          cost_usd: null,
          generated_at: '2026-01-01T00:00:00.000Z',
          truncated: false,
          intent_available: false,
          ...meta,
        },
      }
    : {}),
});

const CUR = { headSha: 'h1', model: { provider: 'openai', model: 'm1' } };

describe('evaluateBriefFreshness', () => {
  it('AC-BRIEF-16 stale reason per head/model/prompt', () => {
    expect(evaluateBriefFreshness(brief(), CUR)).toEqual({ freshness: 'fresh', stale_reasons: [] });
    expect(evaluateBriefFreshness(brief(), { ...CUR, headSha: 'h2' })).toEqual({ freshness: 'stale', stale_reasons: ['pr_changed'] });
    expect(evaluateBriefFreshness(brief(), { ...CUR, model: { provider: 'openai', model: 'm2' } })).toEqual({
      freshness: 'stale',
      stale_reasons: ['model_changed'],
    });
    expect(evaluateBriefFreshness(brief(), { ...CUR, model: { provider: 'anthropic', model: 'm1' } }).stale_reasons).toEqual([
      'model_changed',
    ]);
    expect(evaluateBriefFreshness(brief({ prompt_version: 'brief-v0' }), CUR)).toEqual({
      freshness: 'stale',
      stale_reasons: ['prompt_changed'],
    });
    expect(
      evaluateBriefFreshness(brief({ prompt_version: 'old' }), { headSha: 'h2', model: { provider: 'x', model: 'y' } }).stale_reasons,
    ).toEqual(['pr_changed', 'prompt_changed', 'model_changed']);
  });

  it('AC-BRIEF-16 no model resolved: model not compared; no brief or no meta is unknown', () => {
    expect(evaluateBriefFreshness(brief(), { headSha: 'h1', model: null }).freshness).toBe('fresh');
    expect(evaluateBriefFreshness(null, CUR)).toEqual({ freshness: 'unknown', stale_reasons: [] });
    expect(evaluateBriefFreshness(brief({}, false), CUR)).toEqual({ freshness: 'unknown', stale_reasons: [] });
  });
});

describe('toStoredIntent', () => {
  it('maps a row to an Intent and no row to null', () => {
    expect(toStoredIntent(undefined)).toBeNull();
    expect(toStoredIntent({ intent: 'i', inScope: ['a'], outOfScope: ['b'], riskAreas: ['c'] })).toEqual({
      intent: 'i',
      in_scope: ['a'],
      out_of_scope: ['b'],
      risk_areas: ['c'],
    });
  });
});
