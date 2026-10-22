import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import type { AgentEvalRunRow, EvalCaseRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { NotFoundError } from '../src/platform/errors.js';
import { EVAL_RUNS_DEFAULT_LIMIT, EVAL_RUNS_MAX_LIMIT } from '../src/modules/evals/constants.js';
import { clampLimit, toAgentEvalCase, toAgentEvalRun } from '../src/modules/evals/helpers.js';
import { buildListAgentEvalCasesQuery } from '../src/modules/evals/eval-case.repo.js';
import { buildListAgentEvalRunsQuery, buildListEvalCaseResultsQuery } from '../src/modules/evals/eval-run.repo.js';
import { EvalService, type EvalStore } from '../src/modules/evals/service.js';

/**
 * Unit tests for the eval module's Stage 2 read side (specs/eval-pipeline.md §5,
 * §6, §13). No database: mappers are pure, queries are checked with `.toSQL()`
 * on a never-connected client, and the service runs on an in-memory store.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

const expected = {
  kind: 'must_find',
  file: 'src/a.ts',
  start_line: 3,
  end_line: 5,
  severity: 'WARNING',
  category: 'bug',
  title: 'Off-by-one',
};
const meta = {
  pr_number: 3,
  pr_title: 'Change agents API',
  pr_body: null,
  repo: 'acme/app',
  base: 'main',
  head_sha: 'abc123',
  source_review_id: 'rev-1',
  source_agent_id: AGENT,
  source_agent_version: 1,
  decided_at: '2026-10-22T09:00:00.000Z',
  diff_stats: { files: 2, additions: 10, deletions: 1 },
};

function caseRow(over: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: WS,
    ownerKind: 'agent',
    ownerId: AGENT,
    name: 'must-find-off-by-one',
    inputDiff: 'diff --git a/src/a.ts b/src/a.ts',
    inputFiles: null,
    inputMeta: meta,
    expectedOutput: expected,
    notes: null,
    kind: 'must_find',
    sourceFindingId: 'finding-1',
    inputHash: 'hash-1',
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
    ...over,
  };
}

function runRow(over: Partial<AgentEvalRunRow> = {}): AgentEvalRunRow {
  return {
    id: 'run-1',
    workspaceId: WS,
    agentId: AGENT,
    agentVersion: 2,
    configSnapshot: {},
    promptSha: 'sha',
    status: 'done',
    error: null,
    startedAt: new Date('2026-10-22T10:00:00.000Z'),
    finishedAt: new Date('2026-10-22T10:01:00.000Z'),
    recall: 0.5,
    precision: null,
    citationAccuracy: 1,
    counts: null,
    durationMs: 60_000,
    costUsd: null,
    ...over,
  };
}

describe('toAgentEvalCase', () => {
  it('maps a labeled agent case to the DTO', () => {
    const dto = toAgentEvalCase(caseRow());
    expect(dto).toMatchObject({
      id: 'case-1',
      agent_id: AGENT,
      kind: 'must_find',
      expected,
      meta,
      input_hash: 'hash-1',
      created_at: '2026-10-22T10:00:00.000Z',
      source_finding_id: 'finding-1',
      last_result: null,
    });
  });

  it('attaches the latest result when it has a known outcome', () => {
    const ranAt = new Date('2026-10-22T11:00:00.000Z');
    const dto = toAgentEvalCase(caseRow(), { caseId: 'case-1', suiteRunId: 'run-1', outcome: 'fn', ranAt });
    expect(dto?.last_result).toEqual({ suite_run_id: 'run-1', outcome: 'fn', ran_at: ranAt.toISOString() });
    expect(toAgentEvalCase(caseRow(), { caseId: 'case-1', suiteRunId: 'run-1', outcome: 'weird', ranAt })?.last_result).toBeNull();
  });

  it('treats legacy / foreign rows as not part of the pipeline (null)', () => {
    expect(toAgentEvalCase(caseRow({ kind: null }))).toBeNull(); // pre-L06 row
    expect(toAgentEvalCase(caseRow({ inputHash: null }))).toBeNull();
    expect(toAgentEvalCase(caseRow({ ownerKind: 'skill' }))).toBeNull();
    expect(toAgentEvalCase(caseRow({ expectedOutput: { foo: 1 } }))).toBeNull();
    expect(toAgentEvalCase(caseRow({ inputMeta: null }))).toBeNull();
    // the label column and the frozen expectation must agree
    expect(toAgentEvalCase(caseRow({ kind: 'must_not_flag' }))).toBeNull();
  });
});

describe('toAgentEvalRun', () => {
  it('maps metrics as-is, keeping nulls (never 0 or 1 by default)', () => {
    const dto = toAgentEvalRun(runRow());
    expect(dto).toMatchObject({ recall: 0.5, precision: null, citation_accuracy: 1, counts: null, cost_usd: null });
    expect(dto.finished_at).toBe('2026-10-22T10:01:00.000Z');
  });

  it('degrades unparseable counts to null instead of throwing', () => {
    expect(toAgentEvalRun(runRow({ counts: { tp: 'x' } })).counts).toBeNull();
  });

  it('keeps a running run without finished_at', () => {
    expect(toAgentEvalRun(runRow({ status: 'running', finishedAt: null })).finished_at).toBeNull();
  });
});

describe('clampLimit', () => {
  it('defaults, truncates and clamps into [1, max]', () => {
    expect(clampLimit(undefined, EVAL_RUNS_DEFAULT_LIMIT, EVAL_RUNS_MAX_LIMIT)).toBe(EVAL_RUNS_DEFAULT_LIMIT);
    expect(clampLimit(Number.NaN, 30, 100)).toBe(30);
    expect(clampLimit(0, 30, 100)).toBe(1);
    expect(clampLimit(7.9, 30, 100)).toBe(7);
    expect(clampLimit(1000, 30, 100)).toBe(100);
  });
});

describe('workspace scoping of eval queries (toSQL)', () => {
  const db = drizzle(postgres('postgres://unused:unused@invalid.invalid:5432/unused'), { schema }) as unknown as Db;

  it('lists only labeled agent cases of the workspace', () => {
    const q = buildListAgentEvalCasesQuery(db, WS, AGENT).toSQL();
    expect(q.sql).toContain('"workspace_id" = $1');
    expect(q.sql).toContain('"owner_kind" = $2');
    expect(q.sql).toContain('"owner_id" = $3');
    expect(q.sql).toContain('"kind" is not null');
    expect(q.params).toEqual([WS, 'agent', AGENT]);
  });

  it('lists runs of the agent within the workspace, newest first, limited', () => {
    const q = buildListAgentEvalRunsQuery(db, WS, AGENT, 30).toSQL();
    expect(q.sql).toContain('"workspace_id" = $1');
    expect(q.sql).toContain('"agent_id" = $2');
    expect(q.sql).toMatch(/order by "agent_eval_runs"\."started_at" desc/);
    expect(q.params).toEqual([WS, AGENT, 30]);
  });

  it('reaches per-case results only through the run of the workspace', () => {
    const q = buildListEvalCaseResultsQuery(db, WS, 'run-1').toSQL();
    expect(q.sql).toContain('inner join "agent_eval_runs"');
    expect(q.sql).toContain('"agent_eval_runs"."workspace_id" = $1');
    expect(q.params).toEqual([WS, 'run-1']);
  });
});

describe('EvalService (in-memory store)', () => {
  function makeStore(): EvalStore & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async getAgent(ws, id) {
        calls.push(`getAgent:${ws}`);
        return ws === WS && id === AGENT ? { id, version: 2 } : undefined;
      },
      async listAgentEvalCases(ws) {
        calls.push(`listCases:${ws}`);
        return [caseRow(), caseRow({ id: 'legacy', kind: null }), caseRow({ id: 'case-2' })];
      },
      async listLastCaseResults(ids) {
        calls.push(`last:${ids.join(',')}`);
        return [{ caseId: 'case-2', suiteRunId: 'run-9', outcome: 'tp', ranAt: new Date('2026-10-22T12:00:00.000Z') }];
      },
      async listAgentEvalRuns(ws, _agent, limit) {
        calls.push(`listRuns:${ws}:${limit}`);
        return [runRow()];
      },
    };
  }
  const container = {} as Container;

  it('lists labeled cases with their last result and skips legacy rows', async () => {
    const store = makeStore();
    const out = await new EvalService(container, { store }).listCases(WS, AGENT);
    expect(out.map((c) => c.id)).toEqual(['case-1', 'case-2']);
    expect(out[1]!.last_result?.outcome).toBe('tp');
  });

  it('404s for an agent of another workspace and never reads its cases or runs', async () => {
    const store = makeStore();
    const service = new EvalService(container, { store });
    await expect(service.listCases(OTHER_WS, AGENT)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.listRuns(OTHER_WS, AGENT)).rejects.toBeInstanceOf(NotFoundError);
    expect(store.calls).toEqual([`getAgent:${OTHER_WS}`, `getAgent:${OTHER_WS}`]);
  });

  it('passes the workspace through and clamps the page size', async () => {
    const store = makeStore();
    const service = new EvalService(container, { store });
    await service.listRuns(WS, AGENT);
    await service.listRuns(WS, AGENT, 500);
    expect(store.calls).toContain(`listRuns:${WS}:${EVAL_RUNS_DEFAULT_LIMIT}`);
    expect(store.calls).toContain(`listRuns:${WS}:${EVAL_RUNS_MAX_LIMIT}`);
  });
});
