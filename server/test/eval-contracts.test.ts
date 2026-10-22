import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AgentEvalRun,
  CreateEvalCaseFromFinding,
  EvalConfigSnapshot,
  EvalExpectation,
  FindingRecord,
  StartEvalRunInput,
} from '@devdigest/shared';

/**
 * L06 eval contracts (specs/eval-pipeline.md §6.1): strict inputs, the frozen
 * expectation shape, nullable metrics, backward compatibility of FindingRecord
 * and byte-identity of the L06 block in both vendored copies. No DB, no network.
 */

const expectation = {
  kind: 'must_find',
  file: 'src/a.ts',
  start_line: 3,
  end_line: 5,
  severity: 'WARNING',
  category: 'bug',
  title: 'Off-by-one',
} as const;

describe('CreateEvalCaseFromFinding', () => {
  it('accepts an empty body and an optional kebab-case name', () => {
    expect(CreateEvalCaseFromFinding.parse({})).toEqual({});
    expect(CreateEvalCaseFromFinding.parse({ name: 'must-find-off-by-one', notes: 'x' }).name).toBe('must-find-off-by-one');
  });

  it('rejects a client-sent label (the server derives it) and unknown keys', () => {
    expect(CreateEvalCaseFromFinding.safeParse({ kind: 'must_find' }).success).toBe(false);
    expect(CreateEvalCaseFromFinding.safeParse({ label: 'must_not_flag' }).success).toBe(false);
  });

  it('rejects names that are not lowercase kebab-case or are too long', () => {
    for (const name of ['', 'Has Space', '-leading', 'UPPER', 'a'.repeat(81)]) {
      expect(CreateEvalCaseFromFinding.safeParse({ name }).success).toBe(false);
    }
  });
});

describe('StartEvalRunInput', () => {
  it('is an empty strict object (no agent_version in v1)', () => {
    expect(StartEvalRunInput.parse({})).toEqual({});
    expect(StartEvalRunInput.safeParse({ agent_version: 2 }).success).toBe(false);
  });
});

describe('EvalExpectation', () => {
  it('accepts a valid range, including a single line', () => {
    expect(EvalExpectation.parse(expectation)).toEqual(expectation);
    expect(EvalExpectation.safeParse({ ...expectation, start_line: 5, end_line: 5 }).success).toBe(true);
  });

  it('rejects inverted ranges, line 0, empty file and unknown kinds', () => {
    expect(EvalExpectation.safeParse({ ...expectation, start_line: 6, end_line: 5 }).success).toBe(false);
    expect(EvalExpectation.safeParse({ ...expectation, start_line: 0 }).success).toBe(false);
    expect(EvalExpectation.safeParse({ ...expectation, file: '' }).success).toBe(false);
    expect(EvalExpectation.safeParse({ ...expectation, kind: 'maybe' }).success).toBe(false);
  });
});

describe('AgentEvalRun', () => {
  const run = {
    id: 'r1',
    agent_id: 'a1',
    agent_version: 2,
    prompt_sha: 'abc',
    status: 'running',
    error: null,
    started_at: '2026-10-22T10:00:00.000Z',
    finished_at: null,
    recall: null,
    precision: null,
    citation_accuracy: null,
    counts: null,
    cost_usd: null,
    duration_ms: null,
  } as const;

  it('allows null metrics (undefined / not done) — never forces 0 or 1', () => {
    expect(AgentEvalRun.parse(run).precision).toBeNull();
  });

  it('rejects metrics outside [0, 1]', () => {
    expect(AgentEvalRun.safeParse({ ...run, recall: 1.2 }).success).toBe(false);
    expect(AgentEvalRun.safeParse({ ...run, precision: -0.1 }).success).toBe(false);
  });
});

describe('EvalConfigSnapshot', () => {
  it('requires the frozen prompt and skills with bodies', () => {
    const snap = {
      provider: 'openrouter',
      model: 'm',
      strategy: 'single-pass',
      system_prompt: 'You are a reviewer.',
      agent_version: 1,
      skills: [{ id: 's1', name: 'skill', version: 3, body: '# rules' }],
      excluded: ['repo_intel', 'intent'],
    };
    expect(EvalConfigSnapshot.parse(snap)).toEqual(snap);
    expect(EvalConfigSnapshot.safeParse({ ...snap, skills: [{ id: 's1', name: 'skill', version: 3 }] }).success).toBe(false);
  });
});

describe('FindingRecord backward compatibility', () => {
  const finding = {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    confidence: 0.5,
    review_id: 'rev1',
    accepted_at: null,
    dismissed_at: null,
  };

  it('still parses a pre-L06 record without eval_case_id', () => {
    expect(FindingRecord.parse(finding).eval_case_id).toBeUndefined();
  });

  it('accepts eval_case_id as string or null', () => {
    expect(FindingRecord.parse({ ...finding, eval_case_id: 'c1' }).eval_case_id).toBe('c1');
    expect(FindingRecord.parse({ ...finding, eval_case_id: null }).eval_case_id).toBeNull();
  });
});

describe('vendored contract parity', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const block = (src: string) => {
    const begin = src.indexOf('// L06-EVAL:BEGIN');
    const end = src.indexOf('// L06-EVAL:END');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    return src.slice(begin, end);
  };

  it('the L06 block of eval-ci.ts is identical in the server and client copies', () => {
    const server = read('../src/vendor/shared/contracts/eval-ci.ts');
    const client = read('../../client/src/vendor/shared/contracts/eval-ci.ts');
    expect(block(client)).toBe(block(server));
  });

  it('FindingRecord.eval_case_id is declared in both review-api.ts copies', () => {
    for (const rel of ['../src/vendor/shared/contracts/review-api.ts', '../../client/src/vendor/shared/contracts/review-api.ts']) {
      expect(read(rel)).toContain('eval_case_id: z.string().nullish(),');
    }
  });
});
