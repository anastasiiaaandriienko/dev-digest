import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RunTrace, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { REVIEW_CONCURRENCY } from '../src/modules/reviews/constants.js';
import type { FinalizeDoneRunInput, ReviewRepository, ReviewRow } from '../src/modules/reviews/repository.js';
import type { IntentResolver } from '../src/modules/reviews/intent/for-run.js';
import { DIFF, REVIEW_FIXTURE, agentRow, pullRow, repoRow } from './helpers/run-cost-fixtures.js';

/**
 * L07 T2 — the executor runs a request's agents in parallel (cap
 * REVIEW_CONCURRENCY), isolates failures, keeps per-run logs apart and never
 * calls the model for a run cancelled while it waited for a slot. No real LLM:
 * every model call goes to GatedLLM, which the test releases by hand.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const NO_SKILLS = { effectiveSkills: async () => [] } as unknown as Container['agentsRepo'];

/** Model calls park until the test releases them (keyed by agent model). */
class GatedLLM extends MockLLMProvider {
  started: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private gates = new Map<string, () => void>();

  constructor(private readonly failModels: string[] = []) {
    super('openai', { structured: REVIEW_FIXTURE });
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.started.push(req.model);
    if (this.failModels.includes(req.model)) throw new Error(`provider exploded for ${req.model}`);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise<void>((resolve) => this.gates.set(req.model, resolve));
      return await super.completeStructured(req);
    } finally {
      this.inFlight--;
    }
  }

  release(model: string): void {
    const open = this.gates.get(model);
    if (!open) throw new Error(`no parked call for ${model}`);
    this.gates.delete(model);
    open();
  }

  releaseAll(): void {
    for (const model of [...this.gates.keys()]) this.release(model);
  }
}

/** Repo fake with a per-run status the test can flip (only what the executor calls). */
function fakeRepo() {
  const status = new Map<string, string | null>();
  const statusError = new Set<string>();
  const finalized: FinalizeDoneRunInput[] = [];
  const failed: { runId: string; error: string }[] = [];
  const cancelled: string[] = [];
  const traces = new Map<string, RunTrace>();
  const repo = {
    async getPrFiles() {
      return [];
    },
    async getRunStatus(runId: string) {
      if (statusError.has(runId)) throw new Error('db unreachable');
      return { status: status.get(runId) ?? 'running' };
    },
    async finalizeDoneRun(input: FinalizeDoneRunInput) {
      finalized.push(input);
      status.set(input.runId, 'done');
      return {
        finalized: true as const,
        review: { id: `review-${input.runId}` } as ReviewRow,
        findings: input.findings.map((_, i) => ({ id: `f${i}` }) as FindingRow),
      };
    },
    async recordRunFailed(runId: string, v: { error: string }) {
      if ((status.get(runId) ?? 'running') !== 'running') return 'noop' as const;
      failed.push({ runId, error: v.error });
      status.set(runId, 'failed');
      return 'transitioned' as const;
    },
    async recordRunCancelled(runId: string) {
      const s = status.get(runId) ?? 'running';
      if (s !== 'running' && s !== 'cancelled') return 'noop' as const;
      cancelled.push(runId);
      status.set(runId, 'cancelled');
      return s === 'running' ? ('transitioned' as const) : ('annotated' as const);
    },
    async insertRunTraceIfAbsent(runId: string, trace: RunTrace) {
      if (traces.has(runId)) return false;
      traces.set(runId, trace);
      return true;
    },
  };
  return { repo: repo as unknown as ReviewRepository, status, statusError, finalized, failed, cancelled, traces };
}

function build(o: { llm: MockLLMProvider; resolver?: IntentResolver }) {
  const git = new MockGitClient({ diff: DIFF });
  const container = new Container(config(), {} as Db, {
    secrets: new MockSecretsProvider({}),
    git,
    llm: { openai: o.llm },
  });
  const fake = fakeRepo();
  const executor = new ReviewRunExecutor(container, fake.repo, NO_SKILLS, o.resolver);
  const jobsFor = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      agent: agentRow({ id: `00000000-0000-4000-8000-00000000000${i + 1}`, name: `Agent ${i + 1}`, model: `model-${i + 1}` }),
      runId: randomUUID(),
    }));
  const run = (jobs: ReturnType<typeof jobsFor>) => executor.executeRuns('ws', pullRow(), repoRow(), jobs);
  return { container, git, ...fake, jobsFor, run };
}

const modelOf = (i: number) => `model-${i + 1}`;

describe('ReviewRunExecutor — parallel runs (L07 T2)', () => {
  it('AC-MAR-05: with 6 agents at most REVIEW_CONCURRENCY (4) call the model at once; the 5th starts when a slot frees', async () => {
    expect(REVIEW_CONCURRENCY).toBe(4);
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(6);
    const done = b.run(jobs);

    await vi.waitFor(() => expect(llm.started).toHaveLength(4));
    expect(llm.started).toEqual([0, 1, 2, 3].map(modelOf)); // input order
    // Give the pool a chance to over-start before anything is released.
    await new Promise((r) => setTimeout(r, 20));
    expect(llm.started).toHaveLength(4);

    llm.release(modelOf(1));
    await vi.waitFor(() => expect(llm.started).toHaveLength(5));
    expect(llm.started[4]).toBe(modelOf(4));

    llm.releaseAll();
    await vi.waitFor(() => expect(llm.started).toHaveLength(6));
    llm.releaseAll();
    await done;

    expect(llm.maxInFlight).toBe(4);
    expect(b.finalized.map((f) => f.runId).sort()).toEqual(jobs.map((j) => j.runId).sort());
  });

  it('AC-MAR-06: one agent failing does not stop the others; the failed run is persisted as failed', async () => {
    const llm = new GatedLLM([modelOf(1)]); // agent 2 throws
    const b = build({ llm });
    const jobs = b.jobsFor(3);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(3));
    llm.releaseAll();
    await done; // executeRuns itself resolves

    expect(b.finalized.map((f) => f.runId).sort()).toEqual([jobs[0]!.runId, jobs[2]!.runId].sort());
    expect(b.failed).toHaveLength(1);
    expect(b.failed[0]!.runId).toBe(jobs[1]!.runId);
    expect(b.failed[0]!.error).toContain('provider exploded');
    expect(b.status.get(jobs[1]!.runId)).toBe('failed');
    expect(b.traces.has(jobs[1]!.runId)).toBe(true); // "View trace" still works
  });

  it('AC-MAR-07: the diff is loaded and the intent resolved once for all agents', async () => {
    const llm = new GatedLLM();
    const resolverCalls: string[] = [];
    const resolver: IntentResolver = {
      async resolveForRun(_ws, prId) {
        resolverCalls.push(prId);
        return null;
      },
    };
    const b = build({ llm, resolver });
    const diffSpy = vi.spyOn(b.git, 'diff');
    const done = b.run(b.jobsFor(3));
    await vi.waitFor(() => expect(llm.started).toHaveLength(3));
    llm.releaseAll();
    await done;

    expect(diffSpy).toHaveBeenCalledTimes(1);
    expect(resolverCalls).toHaveLength(1);
    expect(b.finalized).toHaveLength(3);
  });

  it('AC-MAR-08: under concurrency each trace keeps source=local, its stats, and only its own agent lines', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(3);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(3));
    // Finish out of order to interleave the runs' events.
    llm.release(modelOf(2));
    llm.release(modelOf(0));
    llm.release(modelOf(1));
    await done;

    for (const [i, job] of jobs.entries()) {
      const trace = b.finalized.find((f) => f.runId === job.runId)!.trace;
      expect(trace.config.source).toBe('local');
      expect(trace.config.agent).toBe(`Agent ${i + 1}`);
      expect(trace.stats).toMatchObject({ findings: 1, grounding: expect.any(String) });
      expect(typeof trace.stats.tokens_in).toBe('number');
      expect(trace.stats.cost_usd).not.toBeUndefined();
      const msgs = trace.log.map((l) => l.msg);
      // Shared pre-work is in every run's trace …
      expect(msgs.some((m) => m.startsWith('Diff ready'))).toBe(true);
      // … but agent lines only from this run.
      expect(msgs.filter((m) => m.startsWith('Starting review with agent'))).toEqual([
        expect.stringContaining(`"Agent ${i + 1}"`),
      ]);
    }
  });

  it('a run cancelled while queued never calls the model (DB already cancelled, bus flag already cleared)', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(5);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(4));

    // What ReviewService.cancelRun does: flag, DB row → cancelled, complete (clears the flag).
    const queued = jobs[4]!.runId;
    b.container.runBus.cancel(queued);
    b.status.set(queued, 'cancelled');
    b.container.runBus.complete(queued);
    expect(b.container.runBus.isCancelled(queued)).toBe(false);

    llm.releaseAll();
    await done;

    expect(llm.started).not.toContain(modelOf(4));
    expect(llm.started).toHaveLength(4);
    expect(b.finalized.map((f) => f.runId)).not.toContain(queued);
    expect(b.status.get(queued)).toBe('cancelled');
    expect(b.cancelled).toContain(queued);
    expect(b.traces.has(queued)).toBe(true);
    expect(b.container.runBus.isComplete(queued)).toBe(true);
  });

  it('a run whose cancel flag is raised while its DB row still reads running is not started either', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(5);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(4));

    const queued = jobs[4]!.runId;
    b.container.runBus.cancel(queued); // the DB write has not landed yet

    llm.releaseAll();
    await done;

    expect(llm.started).not.toContain(modelOf(4));
    expect(b.status.get(queued)).toBe('cancelled');
    expect(b.cancelled).toEqual([queued]);
  });

  it('a queued run that is no longer running (e.g. reaped) is skipped without a model call or a status rewrite', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(5);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(4));

    const queued = jobs[4]!.runId;
    b.status.set(queued, 'failed');
    llm.releaseAll();
    await done;

    expect(llm.started).not.toContain(modelOf(4));
    expect(b.status.get(queued)).toBe('failed');
    expect(b.failed.map((f) => f.runId)).not.toContain(queued);
    expect(b.traces.has(queued)).toBe(false);
  });

  it('fails closed: when a queued run’s status check errors, it is marked failed and the model is not called', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(5);
    const queued = jobs[4]!.runId;
    b.statusError.add(queued);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(4));
    llm.releaseAll();
    await done;

    expect(llm.started).toEqual([0, 1, 2, 3].map(modelOf));
    expect(b.failed).toHaveLength(1);
    expect(b.failed[0]!.runId).toBe(queued);
    expect(b.failed[0]!.error).toContain('Could not check the run status');
    expect(b.finalized.map((f) => f.runId)).not.toContain(queued);
  });

  it('only runs that waited for a slot re-read their status; the first REVIEW_CONCURRENCY start as before', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const statusSpy = vi.spyOn(b.repo, 'getRunStatus');
    const jobs = b.jobsFor(6);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(4));
    expect(statusSpy).not.toHaveBeenCalled();
    llm.releaseAll();
    await vi.waitFor(() => expect(llm.started).toHaveLength(6));
    llm.releaseAll();
    await done;
    expect(statusSpy.mock.calls.map((c) => c[0])).toEqual([jobs[4]!.runId, jobs[5]!.runId]);
  });

  it('a single-agent request (legacy agentId path) still runs exactly as before', async () => {
    const llm = new GatedLLM();
    const b = build({ llm });
    const jobs = b.jobsFor(1);
    const done = b.run(jobs);
    await vi.waitFor(() => expect(llm.started).toHaveLength(1));
    llm.releaseAll();
    await done;
    expect(b.finalized).toHaveLength(1);
    expect(b.container.runBus.isComplete(jobs[0]!.runId)).toBe(true);
  });
});
