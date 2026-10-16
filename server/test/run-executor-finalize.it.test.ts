import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RunTrace } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import {
  ReviewRepository,
  type FinalizeDoneRunInput,
  type FinalizeDoneRunResult,
} from '../src/modules/reviews/repository.js';
import { cancelRunIfRunning, createAgentRun } from '../src/modules/reviews/repository/run.repo.js';
import { CostLLMProvider, DIFF, REVIEW_FIXTURE, agentRow } from './helpers/run-cost-fixtures.js';

/**
 * L01 Step 2 — executor-level tests E1–E7 (specs/review-run-cost.md §9.1) against
 * a real Postgres. `ProbeRepo` wraps finalizeDoneRun to simulate an ambiguous
 * commit or a cancel landing just before the claim.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Finalize = (input: FinalizeDoneRunInput) => Promise<FinalizeDoneRunResult>;

class ProbeRepo extends ReviewRepository {
  onFinalize?: (input: FinalizeDoneRunInput, real: Finalize) => Promise<FinalizeDoneRunResult>;
  prFilesError?: Error;

  override finalizeDoneRun(input: FinalizeDoneRunInput): Promise<FinalizeDoneRunResult> {
    const real: Finalize = (i) => super.finalizeDoneRun(i);
    return this.onFinalize ? this.onFinalize(input, real) : real(input);
  }

  override getPrFiles(prId: string) {
    if (this.prFilesError) return Promise.reject(this.prFilesError);
    return super.getPrFiles(prId);
  }
}

const isSuccessLine = (m: string) => m.startsWith('Persisted review') || m.startsWith('Run complete;');

d('L01 run finalization — executor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;
  const db = (): Db => pg.handle.db;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setup(opts: { llm?: MockLLMProvider; git?: MockGitClient } = {}) {
    const name = `cost-exec-${seq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const container = new Container(config(), db(), {
      git: opts.git ?? new MockGitClient({ diff: DIFF }),
      llm: { openai: opts.llm ?? new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
    });
    const probe = new ProbeRepo(db());
    const executor = new ReviewRunExecutor(container, probe, container.agentsRepo);
    const runId = await createAgentRun(db(), {
      workspaceId,
      agentId: null,
      prId: pr!.id,
      provider: 'openai',
      model: 'gpt-4.1',
    });
    const run = () =>
      executor.executeRuns(workspaceId, pr!, repo!, [{ agent: agentRow({ workspaceId }), runId }]);
    const msgs = () => container.runBus.buffer(runId).map((e) => e.msg);
    const state = async () => {
      const [row] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      const reviews = await db().select().from(t.reviews).where(eq(t.reviews.runId, runId));
      const [traceRow] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
      return { run: row, reviews, trace: traceRow?.trace as RunTrace | undefined };
    };
    return { container, probe, runId, run, msgs, state };
  }

  it.each([
    ['MockLLMProvider 0.001', () => new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }), 0.001],
    ['unknown cost → null', () => new CostLLMProvider(null), null],
    ['known zero cost → 0', () => new CostLLMProvider(0), 0],
  ] as const)('E1: %s persisted in trace.stats.cost_usd', async (_label, llm, cost) => {
    const s = await setup({ llm: llm() });
    await s.run();
    const { run, reviews, trace } = await s.state();
    expect(run!.status).toBe('done');
    expect(reviews).toHaveLength(1);
    expect(trace!.stats).toHaveProperty('cost_usd', cost);
  });

  it('E2: no success line or bus completion before the commit; trace does not claim them', async () => {
    const s = await setup();
    let atEntry: { msgs: string[]; complete: boolean } | undefined;
    s.probe.onFinalize = (input, real) => {
      atEntry = { msgs: s.msgs(), complete: s.container.runBus.isComplete(s.runId) };
      return real(input);
    };

    await s.run();

    expect(atEntry!.msgs.some(isSuccessLine)).toBe(false);
    expect(atEntry!.complete).toBe(false);
    const after = s.msgs().slice(atEntry!.msgs.length);
    expect(after.filter(isSuccessLine)).toHaveLength(2);
    const { trace } = await s.state();
    expect(trace!.log.map((l) => l.msg).some(isSuccessLine)).toBe(false);
  });

  it('E3: ambiguous commit that committed — stays done, one review, trace untouched', async () => {
    const s = await setup();
    s.probe.onFinalize = async (input, real) => {
      await real(input);
      throw new Error('connection reset');
    };

    await s.run();

    const { run, reviews, trace } = await s.state();
    expect(run!.status).toBe('done');
    expect(run!.error).toBeNull();
    expect(reviews).toHaveLength(1);
    expect(trace!.stats.cost_usd).toBe(0.001);
    expect(s.msgs()).toContain('Run complete (confirmed after a persistence error)');
    expect(s.msgs().some((m) => m.startsWith('Run failed'))).toBe(false);
    expect(s.container.runBus.isComplete(s.runId)).toBe(true);
  });

  it('E4: ambiguous commit that did not commit — failed, no review, buffer trace with null cost', async () => {
    const s = await setup();
    s.probe.onFinalize = async () => {
      throw new Error('connection reset');
    };

    await s.run();

    const { run, reviews, trace } = await s.state();
    expect(run).toMatchObject({ status: 'failed', error: 'connection reset' });
    expect(reviews).toHaveLength(0);
    expect(trace!.stats).toHaveProperty('cost_usd', null);
    expect(trace!.log.map((l) => l.msg)).toContain('Run failed: connection reset');
  });

  it('E5: cancel lands just before the claim — stays cancelled, metadata filled, no review', async () => {
    const s = await setup();
    s.probe.onFinalize = async (input, real) => {
      expect(await cancelRunIfRunning(db(), s.runId)).toBe(true);
      return real(input);
    };

    await s.run();

    const { run, reviews, trace } = await s.state();
    expect(run).toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });
    expect(run!.durationMs).not.toBeNull();
    expect(reviews).toHaveLength(0);
    expect(trace!.stats).toHaveProperty('cost_usd', null);
    expect(s.msgs().some(isSuccessLine)).toBe(false);
  });

  it('E6a: runner sees the cancel flag while the row is still running → cancelled (A)', async () => {
    const s = await setup();
    s.container.runBus.cancel(s.runId);

    await s.run();

    const { run, reviews, trace } = await s.state();
    expect(run).toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });
    expect(reviews).toHaveLength(0);
    expect(trace!.stats).toHaveProperty('cost_usd', null);
  });

  it('E6b: runner sees the flag after the DB cancel → status kept, metadata filled (B)', async () => {
    const s = await setup();
    s.container.runBus.cancel(s.runId);
    await cancelRunIfRunning(db(), s.runId);

    await s.run();

    const { run, trace } = await s.state();
    expect(run).toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });
    expect(run!.durationMs).not.toBeNull();
    expect(trace!.stats).toHaveProperty('cost_usd', null);
  });

  it('E7: pre-work failure marks the run failed with a buffer trace (null cost)', async () => {
    const git = new MockGitClient({ diff: DIFF });
    git.diff = async () => {
      throw new Error('git down');
    };
    const s = await setup({ git });
    s.probe.prFilesError = new Error('db down');

    await s.run();

    const { run, reviews, trace } = await s.state();
    expect(run!.status).toBe('failed');
    expect(run!.error).toContain('Failed to load PR diff');
    expect(reviews).toHaveLength(0);
    expect(trace!.stats).toHaveProperty('cost_usd', null);
  });
});
