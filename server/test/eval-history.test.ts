import { describe, it, expect } from 'vitest';
import type { AgentEvalRun, EvalCaseOutcome, EvalCaseRunResult, EvalConfigSnapshot } from '@devdigest/shared';
import type { AgentEvalRunRow, EvalRunRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';
import {
  compareRuns,
  diffSkills,
  metricDelta,
  summarizeConfig,
  toAgentEvalRunDetail,
  toCaseRunResults,
} from '../src/modules/evals/history.js';
import { EvalService, type EvalStore } from '../src/modules/evals/service.js';

/**
 * Run history + comparison (specs/eval-pipeline.md §6.2, §12.4; ACs 23, 25-27, 30).
 * Pure mappers and the service on an in-memory store — no DB, no LLM.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';

const config = (over: Partial<EvalConfigSnapshot> = {}): EvalConfigSnapshot => ({
  provider: 'openrouter',
  model: 'm1',
  strategy: 'single-pass',
  system_prompt: 'prompt v1',
  agent_version: 1,
  skills: [{ id: 's1', name: 'rules', version: 1, body: 'B1' }],
  excluded: ['repo_intel', 'intent', 'project_context', 'memory', 'conventions'],
  ...over,
});

function runDto(over: Partial<AgentEvalRun> = {}): AgentEvalRun {
  return {
    id: 'r1',
    agent_id: 'a1',
    agent_version: 1,
    prompt_sha: 'sha-1',
    status: 'done',
    error: null,
    started_at: '2026-10-22T10:00:00.000Z',
    finished_at: '2026-10-22T10:01:00.000Z',
    recall: 0.5,
    precision: 0.4,
    citation_accuracy: 0.9,
    counts: null,
    cost_usd: 0.01,
    duration_ms: 1000,
    ...over,
  };
}

function result(caseId: string, outcome: EvalCaseOutcome, kind: 'must_find' | 'must_not_flag' = 'must_find'): EvalCaseRunResult {
  return {
    case_id: caseId,
    case_name: `case-${caseId}`,
    kind,
    outcome,
    pass: outcome === 'tp' || outcome === 'pass',
    expected: { kind, file: 'src/a.ts', start_line: 1, end_line: 1, severity: 'WARNING', category: 'bug', title: 't' },
    matched_finding: null,
    overlapping: [],
    group_fp: [],
    dropped: [],
    error: outcome === 'error' ? 'provider 503' : null,
  };
}

describe('metricDelta (null-safe)', () => {
  it('is head − base, and null when either side is null', () => {
    expect(metricDelta(0.5, 0.75)).toBe(0.25);
    expect(metricDelta(0.75, 0.5)).toBe(-0.25);
    expect(metricDelta(null, 0.5)).toBeNull();
    expect(metricDelta(0.5, null)).toBeNull();
    expect(metricDelta(null, null)).toBeNull();
  });
});

describe('diffSkills', () => {
  it('reports added, removed and changed (version or body) skills by id', () => {
    const base = summarizeConfig(config({ skills: [{ id: 's1', name: 'a', version: 1, body: 'x' }, { id: 's2', name: 'b', version: 1, body: 'y' }] }), 'p')!;
    const head = summarizeConfig(config({ skills: [{ id: 's1', name: 'a', version: 1, body: 'x2' }, { id: 's3', name: 'c', version: 4, body: 'z' }] }), 'p')!;
    expect(diffSkills(base, head)).toEqual([
      { id: 's1', name: 'a', change: 'changed', base_version: 1, head_version: 1 },
      { id: 's2', name: 'b', change: 'removed', base_version: 1, head_version: null },
      { id: 's3', name: 'c', change: 'added', base_version: null, head_version: 4 },
    ]);
  });

  it('never exposes skill bodies in the summary (only a sha256)', () => {
    const s = summarizeConfig(config(), 'p')!;
    expect(JSON.stringify(s)).not.toContain('B1');
    expect(s.skills[0]!.body_sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('compareRuns', () => {
  const base = {
    run: runDto({ id: 'b', prompt_sha: 'sha-1' }),
    config: config(),
    results: [result('c1', 'fn'), result('c2', 'tp'), result('c3', 'pass', 'must_not_flag'), result('c4', 'error'), result('c5', 'tp')],
  };
  const head = {
    run: runDto({ id: 'h', prompt_sha: 'sha-2', recall: 0.75, precision: null, citation_accuracy: 0.9, cost_usd: null, agent_version: 2 }),
    config: config({ system_prompt: 'prompt v2', model: 'm2', agent_version: 2 }),
    results: [result('c1', 'tp'), result('c2', 'fn'), result('c3', 'pass', 'must_not_flag'), result('c4', 'tp'), result('c6', 'fn')],
  };

  it('classifies per-case changes (error counts as a failure)', () => {
    const cmp = compareRuns(base, head);
    expect(Object.fromEntries(cmp.cases.map((c) => [c.case_id, c.change]))).toEqual({
      c1: 'fixed',
      c2: 'regressed',
      c3: 'unchanged',
      c4: 'fixed',
      c5: 'only_base',
      c6: 'only_head',
    });
    expect(cmp.same_case_set).toBe(false);
  });

  it('reports metric deltas with null handling, prompts and config changes', () => {
    const cmp = compareRuns(base, head);
    expect(cmp.delta.recall).toBeCloseTo(0.25);
    expect(cmp.delta.precision).toBeNull(); // head precision undefined
    expect(cmp.delta.citation_accuracy).toBe(0);
    expect(cmp.delta.cost_usd).toBeNull(); // head cost unknown
    expect(cmp.prompt_changed).toBe(true);
    expect([cmp.base_prompt, cmp.head_prompt]).toEqual(['prompt v1', 'prompt v2']);
    expect(cmp.config_changes).toEqual(['model']);
    expect(cmp.config.base!.model).toBe('m1');
    expect(cmp.config.head!.model).toBe('m2');
    expect(cmp.skill_changes).toEqual([]);
  });

  it('flags provider / strategy / skills changes and the same case set', () => {
    const same = [result('c1', 'tp')];
    const cmp = compareRuns(
      { run: runDto({ prompt_sha: 'p' }), config: config(), results: same },
      {
        run: runDto({ prompt_sha: 'p' }),
        config: config({ provider: 'openai', strategy: 'map-reduce', skills: [{ id: 's1', name: 'rules', version: 2, body: 'B2' }] }),
        results: same,
      },
    );
    expect(cmp.prompt_changed).toBe(false);
    expect(cmp.config_changes).toEqual(['provider', 'strategy', 'skills']);
    expect(cmp.skill_changes[0]).toMatchObject({ change: 'changed', base_version: 1, head_version: 2 });
    expect(cmp.same_case_set).toBe(true);
  });

  it('does not invent config changes when a snapshot is unreadable', () => {
    const cmp = compareRuns({ run: runDto(), config: null, results: [] }, { run: runDto(), config: config(), results: [] });
    expect(cmp.config.base).toBeNull();
    expect(cmp.config_changes).toEqual([]);
    expect(cmp.base_prompt).toBe('');
  });
});

describe('toAgentEvalRunDetail / toCaseRunResults', () => {
  const row = {
    id: 'r1',
    workspaceId: WS,
    agentId: 'a1',
    agentVersion: 1,
    configSnapshot: config(),
    promptSha: 'sha',
    status: 'failed',
    error: 'provider 503',
    startedAt: new Date('2026-10-22T10:00:00Z'),
    finishedAt: new Date('2026-10-22T10:00:05Z'),
    recall: null,
    precision: null,
    citationAccuracy: null,
    counts: null,
    durationMs: 5000,
    costUsd: null,
  } as AgentEvalRunRow;
  const stored = (caseId: string, error: string | null): EvalRunRow =>
    ({
      id: `er-${caseId}`,
      caseId,
      suiteRunId: 'r1',
      outcome: error ? 'error' : 'tp',
      actualOutput: {
        input_hash: 'h',
        result: (({ error: _e, ...r }) => r)(result(caseId, error ? 'error' : 'tp')),
        engine: { status: error ? 'failed' : 'ok', error, kept: [], dropped: [], tokens_in: 0, tokens_out: 0, cost_usd: null, duration_ms: 0 },
      },
    }) as unknown as EvalRunRow;

  it('returns stored metrics as-is (null for a failed run) with per-case errors', () => {
    const d = toAgentEvalRunDetail(row, [stored('c2', 'provider 503'), stored('c1', null)]);
    expect(d).toMatchObject({ status: 'failed', error: 'provider 503', recall: null, precision: null, citation_accuracy: null });
    expect(d.config?.system_prompt).toBe('prompt v1');
    expect(d.results.map((r) => [r.case_id, r.outcome, r.error])).toEqual([
      ['c1', 'tp', null],
      ['c2', 'error', 'provider 503'],
    ]);
  });

  it('skips unreadable result rows and nulls an unreadable config instead of failing', () => {
    const broken = { ...stored('c3', null), actualOutput: { nope: true } } as unknown as EvalRunRow;
    expect(toCaseRunResults([broken, stored('c1', null)]).map((r) => r.case_id)).toEqual(['c1']);
    expect(toAgentEvalRunDetail({ ...row, configSnapshot: {} } as AgentEvalRunRow, []).config).toBeNull();
  });
});

// ---- service: scoping and guards --------------------------------------------------

function serviceWith(runs: AgentEvalRunRow[]) {
  const calls: string[] = [];
  const store = {
    getAgentEvalRun: async (ws: string, id: string) => {
      calls.push(`get:${ws}:${id}`);
      return runs.find((r) => r.id === id && r.workspaceId === ws);
    },
    listEvalCaseResults: async (ws: string, id: string) => {
      calls.push(`results:${ws}:${id}`);
      return [];
    },
  } as unknown as EvalStore;
  return { service: new EvalService({} as Container, { store, agents: {} as never, llm: async () => ({}) as never, runner: { execute: async () => undefined } }), calls };
}

const rowOf = (id: string, over: Partial<AgentEvalRunRow> = {}) =>
  ({
    id,
    workspaceId: WS,
    agentId: 'a1',
    agentVersion: 1,
    configSnapshot: config(),
    promptSha: `sha-${id}`,
    status: 'done',
    error: null,
    startedAt: new Date('2026-10-22T10:00:00Z'),
    finishedAt: new Date('2026-10-22T10:01:00Z'),
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    counts: null,
    durationMs: 1,
    costUsd: 0,
    ...over,
  }) as AgentEvalRunRow;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${e.code}` : String(e);
  }
};

describe('EvalService.getRun / compare', () => {
  it('404s for an unknown run or one of another workspace (AC-30)', async () => {
    const { service } = serviceWith([rowOf('r1', { workspaceId: OTHER_WS })]);
    await expect(service.getRun(WS, 'r1')).rejects.toBeInstanceOf(NotFoundError);
    expect(await code(service.compare(WS, 'r1', 'r1'))).toBe('404:not_found');
  });

  it('rejects runs of different agents (422) and runs that are not done (409, AC-27)', async () => {
    const { service } = serviceWith([
      rowOf('a'),
      rowOf('b', { agentId: 'a2' }),
      rowOf('f', { status: 'failed', recall: null, precision: null, citationAccuracy: null }),
      rowOf('r', { status: 'running' }),
    ]);
    expect(await code(service.compare(WS, 'a', 'b'))).toBe('422:different_agents');
    expect(await code(service.compare(WS, 'a', 'f'))).toBe('409:run_not_done');
    expect(await code(service.compare(WS, 'r', 'a'))).toBe('409:run_not_done');
  });

  it('compares two done runs of one agent, reading results only within the workspace', async () => {
    const { service, calls } = serviceWith([rowOf('a'), rowOf('b')]);
    const cmp = await service.compare(WS, 'a', 'b');
    expect(cmp.prompt_changed).toBe(true);
    expect(calls.filter((c) => c.startsWith('results:')).sort()).toEqual([`results:${WS}:a`, `results:${WS}:b`]);
  });
});
