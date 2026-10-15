import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GitClient, RunTrace } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import type {
  FinalizeDoneRunInput,
  FinalizeDoneRunResult,
  ReviewRepository,
  ReviewRow,
} from '../src/modules/reviews/repository.js';
import { RECONCILE_DEADLINE_MS } from '../src/modules/reviews/constants.js';
import {
  CostLLMProvider,
  DIFF,
  REVIEW_FIXTURE,
  agentRow,
  pullRow,
  repoRow,
} from './helpers/run-cost-fixtures.js';

/**
 * L01 Step 2 — executor control flow without a database (specs/review-run-cost.md
 * §3.5–§3.7). The repository is faked, so these tests pin the ORDER of events and
 * which guarded operation is called; the SQL itself is covered by
 * run-finalize.it.test.ts.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Outcome<T> = T | Error | 'hang';

function settle<T>(o: Outcome<T>): Promise<T> {
  if (o === 'hang') return new Promise<T>(() => undefined);
  if (o instanceof Error) return Promise.reject(o);
  return Promise.resolve(o);
}

class FakeRepo {
  calls: string[] = [];
  finalizeInputs: FinalizeDoneRunInput[] = [];
  traces: { runId: string; trace: RunTrace }[] = [];
  finalize: (input: FinalizeDoneRunInput) => Promise<FinalizeDoneRunResult> = async (input) => ({
    finalized: true,
    review: { id: 'review-1' } as ReviewRow,
    findings: input.findings.map((_, i) => ({ id: `finding-${i}` }) as FindingRow),
  });
  failed: Outcome<'transitioned' | 'noop'> = 'transitioned';
  cancelled: Outcome<'transitioned' | 'annotated' | 'noop'> = 'transitioned';
  status: Outcome<{ status: string | null } | undefined> = { status: 'running' };
  prFiles: Outcome<never[]> = [];

  async getPrFiles() {
    return settle(this.prFiles);
  }
  async finalizeDoneRun(input: FinalizeDoneRunInput) {
    this.calls.push('finalize');
    this.finalizeInputs.push(input);
    return this.finalize(input);
  }
  async recordRunFailed() {
    this.calls.push('failed');
    return settle(this.failed);
  }
  async recordRunCancelled() {
    this.calls.push('cancelled');
    return settle(this.cancelled);
  }
  async getRunStatus() {
    this.calls.push('status');
    return settle(this.status);
  }
  async insertRunTraceIfAbsent(runId: string, trace: RunTrace) {
    this.calls.push('trace');
    this.traces.push({ runId, trace });
    return true;
  }
}

/** No DB here ({} as Db): the agent has no skills linked (HW2 #14 adds this lookup). */
const NO_SKILLS = { effectiveSkills: async () => [] } as unknown as Container['agentsRepo'];

function setup(opts: { llm?: MockLLMProvider; git?: GitClient } = {}) {
  const container = new Container(config(), {} as Db, {
    git: opts.git ?? new MockGitClient({ diff: DIFF }),
    llm: { openai: opts.llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
  });
  const repo = new FakeRepo();
  const executor = new ReviewRunExecutor(
    container,
    repo as unknown as ReviewRepository,
    NO_SKILLS,
  );
  const runId = randomUUID();
  const run = () =>
    executor.executeRuns('ws', pullRow(), repoRow(), [{ agent: agentRow(), runId }]);
  const msgs = () => container.runBus.buffer(runId).map((e) => e.msg);
  const isComplete = () => container.runBus.isComplete(runId);
  return { container, repo, runId, run, msgs, isComplete };
}

const isSuccessLine = (m: string) => m.startsWith('Persisted review') || m.startsWith('Run complete;');

afterEach(() => {
  vi.useRealTimers();
});

describe('ReviewRunExecutor — L01 Step 2 finalization (no DB)', () => {
  it('publishes success lines and completes the bus only after the commit; persists cost', async () => {
    const t = setup();
    let atCommit: { msgs: string[]; complete: boolean } | undefined;
    const base = t.repo.finalize;
    t.repo.finalize = async (input) => {
      atCommit = { msgs: t.msgs(), complete: t.isComplete() };
      return base(input);
    };

    await t.run();

    expect(atCommit!.msgs.some(isSuccessLine)).toBe(false);
    expect(atCommit!.complete).toBe(false);
    const after = t.msgs().slice(atCommit!.msgs.length);
    expect(after).toContain('Persisted review review-1 with 1 finding(s)');
    expect(after).toContain('Run complete; trace persisted');
    expect(t.isComplete()).toBe(true);
    expect(t.repo.calls).toEqual(['finalize']);

    const input = t.repo.finalizeInputs[0]!;
    expect(input.trace.stats.cost_usd).toBe(0.001);
    // D1: the persisted trace does not claim the post-commit lines.
    expect(input.trace.log.map((l) => l.msg).some(isSuccessLine)).toBe(false);
    expect(input.completion).toMatchObject({ findingsCount: 1, blockers: 1, grounding: '1/1 passed' });
    expect(input.trace.stats.findings).toBe(1);
    expect(input.reviewedSha).toEqual({ prId: pullRow().id, sha: 'a1b2c3d4' });
    expect(input.review.runId).toBe(t.runId);
  });

  it.each([
    ['unknown cost stays null (key present)', null],
    ['known zero cost stays 0', 0],
  ])('%s', async (_label, cost) => {
    const t = setup({ llm: new CostLLMProvider(cost) });
    await t.run();
    const stats = t.repo.finalizeInputs[0]!.trace.stats;
    expect(stats).toHaveProperty('cost_usd', cost);
  });

  it('ambiguous commit that DID commit: no failed overwrite, no trace write, no false failure', async () => {
    const t = setup();
    t.repo.finalize = async () => {
      throw new Error('connection reset');
    };
    t.repo.failed = 'noop';
    t.repo.status = { status: 'done' };

    await t.run();

    expect(t.repo.calls).toEqual(['finalize', 'failed', 'status']);
    expect(t.msgs()).toContain('Run complete (confirmed after a persistence error)');
    expect(t.msgs().some((m) => m.startsWith('Run failed'))).toBe(false);
    expect(t.msgs().some((m) => m.startsWith('Persisted review'))).toBe(false);
    expect(t.repo.traces).toHaveLength(0);
    expect(t.isComplete()).toBe(true);
  });

  it('ambiguous commit that did NOT commit: failed + buffer trace with null cost', async () => {
    const t = setup();
    t.repo.finalize = async () => {
      throw new Error('connection reset');
    };
    t.repo.failed = 'transitioned';

    await t.run();

    expect(t.repo.calls).toEqual(['finalize', 'failed', 'trace']);
    expect(t.msgs()).toContain('Run failed: connection reset');
    expect(t.msgs().some(isSuccessLine)).toBe(false);
    const trace = t.repo.traces[0]!.trace;
    expect(trace.stats).toHaveProperty('cost_usd', null);
    // The trace is built after the terminal event, so it contains it.
    expect(trace.log.map((l) => l.msg)).toContain('Run failed: connection reset');
    expect(t.isComplete()).toBe(true);
  });

  it('lost the claim to a cancel: keeps it cancelled, annotates, writes trace, no success', async () => {
    const t = setup();
    t.repo.finalize = async () => ({ finalized: false, currentStatus: 'cancelled' });
    t.repo.cancelled = 'annotated';

    await t.run();

    expect(t.repo.calls).toEqual(['finalize', 'cancelled', 'trace']);
    expect(t.msgs()).toContain('Run cancelled by user');
    expect(t.msgs().some(isSuccessLine)).toBe(false);
    expect(t.repo.traces[0]!.trace.stats).toHaveProperty('cost_usd', null);
  });

  it('runner sees the cancel flag: never finalizes; records the cancellation', async () => {
    const t = setup();
    t.container.runBus.cancel(t.runId);

    await t.run();

    expect(t.repo.calls).toEqual(['cancelled', 'trace']);
    expect(t.msgs()).toContain('Run cancelled by user');
    expect(t.isComplete()).toBe(true);
  });

  it('failed for another reason after a user cancel: status kept, cancellation metadata filled', async () => {
    const t = setup();
    t.repo.finalize = async () => {
      throw new Error('boom');
    };
    t.repo.failed = 'noop';
    t.repo.status = { status: 'cancelled' };
    t.repo.cancelled = 'annotated';

    await t.run();

    expect(t.repo.calls).toEqual(['finalize', 'failed', 'status', 'cancelled', 'trace']);
    expect(t.msgs()).toContain('Run cancelled by user');
    expect(t.msgs().some((m) => m.startsWith('Run failed'))).toBe(false);
  });

  it('run row deleted before the claim: no writes, no trace', async () => {
    const t = setup();
    t.repo.finalize = async () => ({ finalized: false, currentStatus: null });
    t.repo.failed = 'noop';
    t.repo.status = undefined;

    await t.run();

    expect(t.repo.calls).toEqual(['finalize', 'failed', 'status']);
    expect(t.msgs()).toContain('Run no longer exists');
    expect(t.repo.traces).toHaveLength(0);
  });

  it('run already failed (reaped) before the claim: reported as ended, no trace', async () => {
    const t = setup();
    t.repo.finalize = async () => ({ finalized: false, currentStatus: 'failed' });
    t.repo.failed = 'noop';
    t.repo.status = { status: 'failed' };

    await t.run();

    expect(t.msgs()).toContain('Run already ended with status failed');
    expect(t.repo.traces).toHaveLength(0);
  });

  it('probe rejected by the DB lock timeout: outcome unknown, nothing claimed', async () => {
    const t = setup();
    t.repo.finalize = async () => {
      throw new Error('connection reset');
    };
    t.repo.failed = new Error('canceling statement due to lock timeout');

    await t.run();

    expect(t.msgs()).toContain('Run outcome unknown: canceling statement due to lock timeout');
    expect(t.msgs().some((m) => m.startsWith('Run failed') || isSuccessLine(m))).toBe(false);
    expect(t.repo.traces).toHaveLength(0);
    expect(t.isComplete()).toBe(true);
  });

  it('probe that never answers is cut off by the client-side deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    t.repo.finalize = async () => {
      throw new Error('connection reset');
    };
    t.repo.failed = 'hang';

    let finished = false;
    const p = t.run().then(() => {
      finished = true;
    });
    for (let i = 0; i < 100 && !finished; i++) {
      await vi.advanceTimersByTimeAsync(RECONCILE_DEADLINE_MS / 10);
    }
    await p;

    expect(t.msgs()).toContain(`Run outcome unknown: timed out after ${RECONCILE_DEADLINE_MS}ms`);
    expect(t.repo.traces).toHaveLength(0);
    expect(t.isComplete()).toBe(true);
  });

  it.each([
    ['transitioned', 1],
    ['noop', 0],
  ] as const)('pre-work failure: guarded failed write (%s) → %i buffer trace(s)', async (result, traces) => {
    const git = {
      diff: async () => {
        throw new Error('git down');
      },
    } as unknown as GitClient;
    const t = setup({ git });
    t.repo.prFiles = new Error('db down');
    t.repo.failed = result;

    await t.run();

    expect(t.repo.calls.filter((c) => c === 'finalize')).toHaveLength(0);
    expect(t.repo.traces).toHaveLength(traces);
    if (traces) expect(t.repo.traces[0]!.trace.stats).toHaveProperty('cost_usd', null);
    expect(t.isComplete()).toBe(true);
  });
});
