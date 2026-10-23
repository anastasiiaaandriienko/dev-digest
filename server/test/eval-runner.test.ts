import { describe, it, expect } from 'vitest';
import type { EvalConfigSnapshot, LLMProvider } from '@devdigest/shared';
import type { AgentEvalRunRow, AgentRow, EvalCaseRow, EvalRunRow } from '../src/db/rows.js';
import type { Container } from '../src/platform/container.js';
import { AppError, ConfigError, NotFoundError } from '../src/platform/errors.js';
import { EVAL_MAX_CASES, EVAL_MAX_FINDINGS_PER_GROUP } from '../src/modules/evals/constants.js';
import { EvalRunner, groupsFromStored, StoredCaseOutput, type EvalRunFinal, type EvalRunJob } from '../src/modules/evals/runner.js';
import type { EvalRunInsert } from '../src/modules/evals/repository.js';
import { scoreSuite } from '../src/modules/evals/scoring.js';
import { EvalService, type EvalAgentSource, type EvalStore } from '../src/modules/evals/service.js';
import { addedFileDiff, evalCaseRow, finding, review, ScriptedLLM } from './helpers/eval-fixtures.js';

/**
 * Eval runner + run start (specs/eval-pipeline.md §9-§11; ACs 09-13, 21).
 * Real reviewer-core engine with a scripted in-memory LLM; in-memory stores.
 * No DB, no network, no paid call.
 */

const WS = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const DIFF_A = addedFileDiff({ 'src/a.ts': 30 });
const DIFF_B = addedFileDiff({ 'src/b.ts': 30 });

const CONFIG: EvalConfigSnapshot = {
  provider: 'openrouter',
  model: 'm',
  strategy: 'single-pass',
  system_prompt: 'You are the frozen test reviewer.',
  agent_version: 3,
  skills: [{ id: 's1', name: 'rules', version: 2, body: 'FROZEN-SKILL-BODY' }],
  excluded: ['repo_intel', 'intent', 'project_context', 'memory', 'conventions'],
};

const cases = (): EvalCaseRow[] => [
  evalCaseRow({ id: 'c1', workspaceId: WS, agentId: AGENT, kind: 'must_find', file: 'src/a.ts', start: 5, diff: DIFF_A, prNumber: 7, prTitle: 'Frozen title A', prBody: 'Frozen body A' }),
  evalCaseRow({ id: 'c2', workspaceId: WS, agentId: AGENT, kind: 'must_not_flag', file: 'src/a.ts', start: 20, diff: DIFF_A, prNumber: 7, prTitle: 'Frozen title A', prBody: 'Frozen body A' }),
  evalCaseRow({ id: 'c3', workspaceId: WS, agentId: AGENT, kind: 'must_find', file: 'src/b.ts', start: 9, diff: DIFF_B, prNumber: 8, prTitle: 'Frozen title B' }),
];

function capture() {
  const finalized: { runId: string; final: EvalRunFinal; rows: EvalRunInsert[] }[] = [];
  return {
    finalized,
    sink: {
      async finalize(runId: string, final: EvalRunFinal, rows: EvalRunInsert[]) {
        finalized.push({ runId, final, rows });
        return true;
      },
    },
  };
}

const job = (over: Partial<EvalRunJob> = {}): EvalRunJob => ({ runId: 'run-1', config: CONFIG, cases: cases(), ...over });

/** Responses keyed by which frozen diff the request carries. */
function byInput(a: ReturnType<typeof review> | Error, b: ReturnType<typeof review> | Error) {
  return (req: { messages: { content: string }[] }) =>
    req.messages.some((m) => m.content.includes('src/b.ts')) ? b : a;
}

describe('EvalRunner — one engine call per frozen input (AC-13)', () => {
  it('groups by input_hash, calls the engine once per group and scores every case', async () => {
    const llm = new ScriptedLLM([
      byInput(review([finding('src/a.ts', 5), finding('src/a.ts', 25)]), review([finding('src/b.ts', 9), finding('src/zzz.ts', 1)])),
    ]);
    const { sink, finalized } = capture();
    const final = await new EvalRunner({ llm: async () => llm, sink }).execute(job());

    expect(llm.requests).toHaveLength(2); // 3 cases, 2 distinct inputs
    expect(final.status).toBe('done');
    // kept: a:5 (TP), a:25 (unlabeled FP), b:9 (TP); dropped: zzz.ts (not in diff)
    expect(final.counts).toMatchObject({ tp: 2, fn: 0, fp: 1, kept: 3, raw: 4, valid_citations: 3, cases_total: 3, cases_passed: 3 });
    expect(final.counts.tokens_in).toBe(200);
    expect(final.recall).toBe(1);
    expect(final.precision).toBeCloseTo(2 / 3);
    expect(final.citationAccuracy).toBeCloseTo(3 / 4);
    expect(final.costUsd).toBeCloseTo(0.004);

    const rows = finalized[0]!.rows;
    expect(rows.map((r) => r.caseId).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(rows.every((r) => r.suiteRunId === 'run-1')).toBe(true);
    const c1 = StoredCaseOutput.parse(rows.find((r) => r.caseId === 'c1')!.actualOutput);
    expect(c1.engine.kept.map((f) => f.start_line)).toEqual([5, 25]);
    expect(c1.result.outcome).toBe('tp');
    // the group's cost is split over its two cases
    expect(rows.find((r) => r.caseId === 'c1')!.costUsd).toBeCloseTo(0.001);
  });

  it('sends ONLY the frozen input: diff, PR title/body, snapshot prompt and skill bodies', async () => {
    const llm = new ScriptedLLM([review([])]);
    await new EvalRunner({ llm: async () => llm, sink: capture().sink }).execute(job({ cases: cases().slice(0, 1) }));
    const text = llm.requests[0]!.messages.map((m) => m.content).join('\n');
    expect(text).toContain('You are the frozen test reviewer.');
    expect(text).toContain('FROZEN-SKILL-BODY');
    expect(text).toContain('Frozen title A');
    expect(text).toContain('Frozen body A');
    expect(text).toContain('+line 5 of src/a.ts');
    expect(text).toContain('by the PR author');
    for (const heading of ['## Callers of changed symbols', '## Repo skeleton', '## PR intent', '## Project context', '## Relevant memory']) {
      expect(text).not.toContain(heading);
    }
  });
});

describe('EvalRunner — failures and limits (AC-21, §8.7)', () => {
  it('stops at the first failed group: later groups are not called, metrics null, finished rows kept', async () => {
    // inputs run in input_hash order; make whichever comes first succeed and the second fail
    let n = 0;
    const llm = new ScriptedLLM([() => (n++ === 0 ? review([finding('src/a.ts', 5), finding('src/b.ts', 9)]) : new Error('upstream 503'))]);
    const three = [
      ...cases(),
      evalCaseRow({ id: 'c4', workspaceId: WS, agentId: AGENT, kind: 'must_find', file: 'src/c.ts', start: 1, diff: addedFileDiff({ 'src/c.ts': 5 }), prNumber: 9 }),
    ];
    const { sink, finalized } = capture();
    const final = await new EvalRunner({ llm: async () => llm, sink }).execute(job({ cases: three }));

    // which frozen input each request carried: only 2 of the 3 inputs ever reach the LLM
    const inputsSent = new Set(
      llm.requests.map((r) => r.messages.map((m) => m.content).join('\n').match(/\+line 1 of (src\/[a-z]\.ts)/)![1]),
    );
    expect(inputsSent.size).toBe(2);
    expect(final.status).toBe('failed');
    expect(final.error).toContain('upstream 503');
    expect([final.recall, final.precision, final.citationAccuracy]).toEqual([null, null, null]);
    expect(final.costUsd).toBeNull();
    const outcomes = finalized[0]!.rows.map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'error').length).toBeGreaterThanOrEqual(1);
    expect(outcomes.some((o) => o !== 'error')).toBe(true); // the finished group is kept
    const skipped = finalized[0]!.rows
      .map((r) => StoredCaseOutput.parse(r.actualOutput).engine.error)
      .filter((e) => e === 'skipped after an earlier failure');
    expect(skipped.length).toBe(1);
  });

  it('fails a group (not truncates it) when the engine returns too many findings', async () => {
    const many = Array.from({ length: EVAL_MAX_FINDINGS_PER_GROUP + 1 }, (_, i) => finding('src/a.ts', (i % 30) + 1, (i % 30) + 1, { id: `f${i}` }));
    const llm = new ScriptedLLM([review(many)]);
    const { sink, finalized } = capture();
    const final = await new EvalRunner({ llm: async () => llm, sink }).execute(job({ cases: cases().slice(0, 2) }));
    expect(final.status).toBe('failed');
    expect(final.error).toContain(`limit ${EVAL_MAX_FINDINGS_PER_GROUP}`);
    expect(final.precision).toBeNull();
    expect(finalized[0]!.rows.every((r) => r.outcome === 'error')).toBe(true);
  });

  it('records an unknown cost as null, never 0', async () => {
    const llm = new ScriptedLLM([review([])], { costUsd: null });
    const final = await new EvalRunner({ llm: async () => llm, sink: capture().sink }).execute(job());
    expect(final.status).toBe('done');
    expect(final.costUsd).toBeNull();
  });

  it('fails every case when the provider cannot be built', async () => {
    const { sink, finalized } = capture();
    const final = await new EvalRunner({
      llm: async () => {
        throw new ConfigError('no key');
      },
      sink,
    }).execute(job());
    expect(final.status).toBe('failed');
    expect(finalized[0]!.rows.every((r) => r.outcome === 'error')).toBe(true);
  });
});

describe('re-scoring from stored data (§10)', () => {
  it('scoreSuite(groupsFromStored(...)) reproduces the stored metrics exactly', async () => {
    const llm = new ScriptedLLM([
      byInput(review([finding('src/a.ts', 5), finding('src/a.ts', 5), finding('src/a.ts', 20)]), review([finding('src/b.ts', 40)])),
    ]);
    const { sink, finalized } = capture();
    const final = await new EvalRunner({ llm: async () => llm, sink }).execute(job());
    const stored = JSON.parse(JSON.stringify(finalized[0]!.rows)) as EvalRunRow[];
    const again = scoreSuite(groupsFromStored(cases(), stored));
    expect(again.recall).toBe(final.recall);
    expect(again.precision).toBe(final.precision);
    expect(again.citation_accuracy).toBe(final.citationAccuracy);
    const { tokens_in: _ti, tokens_out: _to, ...counts } = final.counts;
    expect(again.counts).toEqual(counts);
  });
});

// ---- EvalService.startRun ------------------------------------------------------

function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: AGENT,
    workspaceId: WS,
    name: 'Test Reviewer',
    description: '',
    provider: 'openrouter',
    model: 'deepseek/x',
    systemPrompt: 'Prompt v3',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    version: 3,
    createdBy: null,
    createdAt: new Date(),
    ...over,
  } as AgentRow;
}

function startSetup(opts: { cases?: EvalCaseRow[]; running?: AgentEvalRunRow; insertError?: unknown; llmError?: Error; runnerError?: Error } = {}) {
  const calls: string[] = [];
  const jobs: EvalRunJob[] = [];
  const failed: string[] = [];
  const store = {
    listAgentEvalCases: async () => opts.cases ?? cases(),
    failRunningAgentEvalRuns: async (_e: string, scope?: { agentId: string }) => {
      calls.push(`stale:${scope?.agentId}`);
      return 0;
    },
    getRunningAgentEvalRun: async () => opts.running,
    insertAgentEvalRun: async (values: Record<string, unknown>) => {
      calls.push('insert');
      if (opts.insertError) throw opts.insertError;
      return { id: 'run-new', startedAt: new Date('2026-10-22T10:00:00Z'), finishedAt: null, error: null, recall: null, precision: null, citationAccuracy: null, counts: null, durationMs: null, costUsd: null, ...values } as AgentEvalRunRow;
    },
    failAgentEvalRun: async (id: string, error: string) => {
      failed.push(`${id}:${error}`);
      return true;
    },
  } as unknown as EvalStore;
  const agents: EvalAgentSource = {
    getById: async (ws, id) => (ws === WS && id === AGENT ? agentRow() : undefined),
    effectiveSkills: async () => [{ id: 's1', name: 'rules', version: 2, body: 'BODY' }],
  };
  const service = new EvalService({} as Container, {
    store,
    agents,
    llm: async () => {
      calls.push('llm');
      if (opts.llmError) throw opts.llmError;
      return new ScriptedLLM([review([])]) as LLMProvider;
    },
    runner: {
      execute: async (j) => {
        jobs.push(j);
        if (opts.runnerError) throw opts.runnerError;
      },
    },
  });
  return { service, calls, jobs, failed };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${e.code}` : String(e);
  }
};

describe('EvalService.startRun (AC-09..12)', () => {
  it('snapshots the current config with skill bodies, inserts a running row and starts the runner', async () => {
    const { service, jobs, calls } = startSetup();
    const run = await service.startRun(WS, AGENT, {});
    expect(run.status).toBe('running');
    expect(run.agent_version).toBe(3);
    expect(run.prompt_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(jobs[0]!.config).toEqual({
      provider: 'openrouter',
      model: 'deepseek/x',
      strategy: 'single-pass',
      system_prompt: 'Prompt v3',
      agent_version: 3,
      skills: [{ id: 's1', name: 'rules', version: 2, body: 'BODY' }],
      excluded: ['repo_intel', 'intent', 'project_context', 'memory', 'conventions'],
    });
    expect(calls).toEqual(['llm', `stale:${AGENT}`, 'insert']);
  });

  it('404s for an agent of another workspace', async () => {
    await expect(startSetup().service.startRun('22222222-2222-4222-8222-222222222222', AGENT, {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects no cases and too many cases with 422 and writes nothing', async () => {
    const none = startSetup({ cases: [] });
    expect(await code(none.service.startRun(WS, AGENT, {}))).toBe('422:no_eval_cases');
    const lots = Array.from({ length: EVAL_MAX_CASES + 1 }, (_, i) =>
      evalCaseRow({ id: `c${i}`, workspaceId: WS, agentId: AGENT, kind: 'must_find', file: 'src/a.ts', start: (i % 30) + 1, diff: DIFF_A }),
    );
    const many = startSetup({ cases: lots });
    expect(await code(many.service.startRun(WS, AGENT, {}))).toBe('422:too_many_cases');
    expect([...none.calls, ...many.calls]).not.toContain('insert');
  });

  it('fails on a missing provider key before inserting a run row (AC-12)', async () => {
    const s = startSetup({ llmError: new ConfigError('OPENROUTER key missing') });
    expect(await code(s.service.startRun(WS, AGENT, {}))).toBe('500:config_error');
    expect(s.calls).not.toContain('insert');
  });

  it('rejects a second run while one is running (409), incl. the unique-index race (AC-11)', async () => {
    const running = startSetup({ running: { id: 'run-old' } as AgentEvalRunRow });
    expect(await code(running.service.startRun(WS, AGENT, {}))).toBe('409:eval_run_in_progress');
    const race = startSetup({ insertError: Object.assign(new Error('dup'), { code: '23505' }) });
    expect(await code(race.service.startRun(WS, AGENT, {}))).toBe('409:eval_run_in_progress');
  });

  it('marks the run failed when the background runner throws', async () => {
    const s = startSetup({ runnerError: new Error('db down') });
    await s.service.startRun(WS, AGENT, {});
    await new Promise((r) => setTimeout(r, 0));
    expect(s.failed).toEqual(['run-new:runner error: db down']);
  });
});

// ---- D-1: long runs are never "stale"; a run failed from outside stops paying ----

describe("EvalRunner — stops when its run is no longer running", () => {
  it("asks before every engine call and stops without further paid calls", async () => {
    let asked = 0;
    const llm = new ScriptedLLM([review([finding("src/a.ts", 5)])]);
    const finalized: EvalRunFinal[] = [];
    const final = await new EvalRunner({
      llm: async () => llm,
      sink: {
        finalize: async (_id, f) => (finalized.push(f), false),
        // the run is failed from outside (e.g. reaped) after the first group
        isRunning: async () => asked++ === 0,
      },
    }).execute(job());
    expect(llm.requests).toHaveLength(1); // the second input never reaches the LLM
    expect(final.status).toBe("failed");
    expect(final.error).toBe("stopped: the run is no longer running");
    expect(finalized).toHaveLength(1);
  });
});

describe("EvalService.startRun — active runs are never stale (D-1)", () => {
  function setupWithRegistry() {
    const runs = new Map<string, AgentEvalRunRow>();
    const staleScopes: { excludeIds?: readonly string[] }[] = [];
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    let seq = 0;
    const store = {
      listAgentEvalCases: async () => cases(),
      failRunningAgentEvalRuns: async (_e: string, scope?: { excludeIds?: readonly string[] }) => {
        staleScopes.push({ excludeIds: scope?.excludeIds });
        return 0;
      },
      getRunningAgentEvalRun: async () => [...runs.values()].find((r) => r.status === "running"),
      insertAgentEvalRun: async (values: Record<string, unknown>) => {
        const row = { id: `run-${++seq}`, startedAt: new Date(), finishedAt: null, error: null, recall: null, precision: null, citationAccuracy: null, counts: null, durationMs: null, costUsd: null, ...values } as AgentEvalRunRow;
        runs.set(row.id, row);
        return row;
      },
      failAgentEvalRun: async () => true,
    } as unknown as EvalStore;
    const service = new EvalService({} as Container, {
      store,
      agents: { getById: async () => agentRow(), effectiveSkills: async () => [] },
      llm: async () => new ScriptedLLM([review([])]) as LLMProvider,
      // a long-running run: resolves only when the test says so
      runner: { execute: () => pending.then(() => void runs.set("run-1", { ...runs.get("run-1")!, status: "done" })) },
    });
    return { service, staleScopes, release, pending };
  }

  it("keeps a run executing in this process out of the stale check and refuses a parallel run", async () => {
    const { service, staleScopes, release, pending } = setupWithRegistry();
    const first = await service.startRun(WS, AGENT, {});
    expect(first.id).toBe("run-1");
    // however old run-1 is, it is excluded from the stale check → still running → 409
    expect(await code(service.startRun(WS, AGENT, {}))).toBe("409:eval_run_in_progress");
    expect(staleScopes.at(-1)!.excludeIds).toContain("run-1");
    release();
    await pending;
    await new Promise((r) => setTimeout(r, 0));
    // finished → removed from the registry, the next start may run
    const next = await service.startRun(WS, AGENT, {});
    expect(next.id).toBe("run-2");
    expect(staleScopes.at(-1)!.excludeIds).not.toContain("run-1");
  });
});
