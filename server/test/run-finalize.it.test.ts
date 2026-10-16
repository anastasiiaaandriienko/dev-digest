import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { Finding, RunTrace } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  cancelRunIfRunning,
  createAgentRun,
  deleteAgentRun,
  finalizeDoneRun,
  insertRunTraceIfAbsent,
  recordRunCancelled,
  recordRunFailed,
  type FinalizeDoneRunInput,
} from '../src/modules/reviews/repository/run.repo.js';
import { REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';

/**
 * L01 Step 2 — repository-level tests R1–R16 (specs/review-run-cost.md §9.1):
 * the success transaction, its rollback, the claim/cancel race and the guarded
 * terminal writes, against a real Postgres.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function traceDoc(cost: number | null, rawOutput = '{}'): RunTrace {
  return {
    config: { agent: 'Cost Reviewer', version: '1', provider: 'openai', model: 'gpt-4.1', pr: 482, source: 'local' },
    stats: { duration_ms: 10, tokens_in: 100, tokens_out: 50, findings: 1, grounding: '1/1 passed', cost_usd: cost },
    prompt_assembly: { system: 's', skills: null, memory: null, specs: null, user: 'u' },
    tool_calls: [],
    raw_output: rawOutput,
    memory_pulled: [],
    specs_read: [],
    log: [{ t: '00:00:00', kind: 'info', msg: 'started' }],
  };
}

d('L01 run finalization — repository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;
  const db = () => pg.handle.db;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function newPr() {
    const name = `cost-repo-${seq++}`;
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
    return pr!;
  }

  async function newRun(prId: string) {
    return createAgentRun(db(), { workspaceId, agentId: null, prId, provider: 'openai', model: 'gpt-4.1' });
  }

  function input(
    runId: string,
    prId: string,
    opts: { cost?: number | null; findings?: Finding[]; rawOutput?: string } = {},
  ): FinalizeDoneRunInput {
    const findings = opts.findings ?? REVIEW_FIXTURE.findings;
    return {
      runId,
      review: {
        workspaceId,
        prId,
        agentId: null,
        runId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'summary',
        score: 65,
        model: 'gpt-4.1',
      },
      findings,
      reviewedSha: { prId, sha: 'a1b2c3d4' },
      completion: {
        durationMs: 10,
        tokensIn: 100,
        tokensOut: 50,
        findingsCount: findings.length,
        grounding: '1/1 passed',
        score: 65,
        blockers: 1,
      },
      trace: traceDoc(opts.cost === undefined ? 0.001 : opts.cost, opts.rawOutput),
    };
  }

  /** Everything finalizeDoneRun may write, for "nothing persisted" checks. */
  async function state(runId: string, prId: string) {
    const [run] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    const reviews = await db().select().from(t.reviews).where(eq(t.reviews.runId, runId));
    const findings = reviews.length
      ? await db().select().from(t.findings).where(inArray(t.findings.reviewId, reviews.map((r) => r.id)))
      : [];
    const [pr] = await db().select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
    const [trace] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    return {
      run,
      reviews,
      findings,
      lastReviewedSha: pr!.lastReviewedSha,
      trace: trace?.trace as RunTrace | undefined,
    };
  }

  async function expectNothingPersisted(runId: string, prId: string, status: string | undefined) {
    const s = await state(runId, prId);
    expect(s.run?.status).toBe(status);
    expect(s.reviews).toHaveLength(0);
    expect(s.findings).toHaveLength(0);
    expect(s.lastReviewedSha).toBeNull();
    expect(s.trace).toBeUndefined();
  }

  // ---- commit + cost ----------------------------------------------------

  it('R1: commits done + review + findings + reviewed sha + trace with the cost', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);

    const res = await finalizeDoneRun(db(), input(runId, pr.id));

    expect(res.finalized).toBe(true);
    const s = await state(runId, pr.id);
    expect(s.run).toMatchObject({
      status: 'done',
      durationMs: 10,
      tokensIn: 100,
      tokensOut: 50,
      findingsCount: 1,
      grounding: '1/1 passed',
      score: 65,
      blockers: 1,
      error: null,
    });
    expect(s.reviews).toHaveLength(1);
    expect(s.findings).toHaveLength(1);
    expect(s.lastReviewedSha).toBe('a1b2c3d4');
    expect(s.trace!.stats.cost_usd).toBe(0.001);
  });

  it('R2: unknown cost is stored as null with the key present', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    await finalizeDoneRun(db(), input(runId, pr.id, { cost: null }));
    expect((await state(runId, pr.id)).trace!.stats).toHaveProperty('cost_usd', null);
  });

  it('R3: known zero cost is stored as 0, not null', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    await finalizeDoneRun(db(), input(runId, pr.id, { cost: 0 }));
    expect((await state(runId, pr.id)).trace!.stats.cost_usd).toBe(0);
  });

  // ---- rollback ---------------------------------------------------------

  it('R4: a failing findings insert rolls back the claim and everything else', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    const bad = [{ ...REVIEW_FIXTURE.findings[0]!, title: undefined as unknown as string }];

    // Assumption under test (§3.10): this violates findings.title NOT NULL.
    await expect(finalizeDoneRun(db(), input(runId, pr.id, { findings: bad }))).rejects.toThrow();
    await expectNothingPersisted(runId, pr.id, 'running');
  });

  it('R5: a failing trace write rolls back the claim, review, findings and reviewed sha', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);

    // Assumption under test (§3.10): jsonb rejects the \u0000 escape.
    await expect(
      finalizeDoneRun(db(), input(runId, pr.id, { rawOutput: 'bad \u0000 byte' })),
    ).rejects.toThrow();
    await expectNothingPersisted(runId, pr.id, 'running');
  });

  // ---- claim vs cancel / delete -------------------------------------------

  it('R6: a run cancelled before the claim is never finalized', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    expect(await cancelRunIfRunning(db(), runId)).toBe(true);

    const res = await finalizeDoneRun(db(), input(runId, pr.id));

    expect(res).toEqual({ finalized: false, currentStatus: 'cancelled' });
    await expectNothingPersisted(runId, pr.id, 'cancelled');
  });

  it('R7: a run deleted before the claim reports a missing row and writes nothing', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    expect(await deleteAgentRun(db(), workspaceId, runId)).toBe(true);

    const res = await finalizeDoneRun(db(), input(runId, pr.id));

    expect(res).toEqual({ finalized: false, currentStatus: null });
    await expectNothingPersisted(runId, pr.id, undefined);
  });

  it('R8: claim holds the row lock; a concurrent cancel waits and then sees done', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    let cancel: Promise<boolean> | undefined;

    await db().transaction(async (tx) => {
      const res = await finalizeDoneRun(tx, input(runId, pr.id)); // savepoint inside tx
      expect(res.finalized).toBe(true);
      cancel = cancelRunIfRunning(db(), runId);
      const raced = await Promise.race([cancel.then(() => 'settled'), sleep(200).then(() => 'pending')]);
      expect(raced).toBe('pending');
    });

    expect(await cancel!).toBe(false);
    const s = await state(runId, pr.id);
    expect(s.run!.status).toBe('done');
    expect(s.reviews).toHaveLength(1);
    expect(s.trace!.stats.cost_usd).toBe(0.001);
  });

  it('R9: claim holds the lock then rolls back; the waiting cancel wins', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    let cancel: Promise<boolean> | undefined;

    await expect(
      db().transaction(async (tx) => {
        await finalizeDoneRun(tx, input(runId, pr.id));
        cancel = cancelRunIfRunning(db(), runId);
        const raced = await Promise.race([cancel.then(() => 'settled'), sleep(200).then(() => 'pending')]);
        expect(raced).toBe('pending');
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(await cancel!).toBe(true);
    await expectNothingPersisted(runId, pr.id, 'cancelled');
  });

  it('R10: racing finalize and cancel always ends in exactly one consistent state', async () => {
    for (let i = 0; i < 20; i++) {
      const pr = await newPr();
      const runId = await newRun(pr.id);
      const [fin, cancelled] = await Promise.all([
        finalizeDoneRun(db(), input(runId, pr.id)),
        cancelRunIfRunning(db(), runId),
      ]);
      const s = await state(runId, pr.id);
      if (fin.finalized) {
        expect(cancelled).toBe(false);
        expect(s.run!.status).toBe('done');
        expect(s.reviews).toHaveLength(1);
        expect(s.trace).toBeDefined();
      } else {
        expect(cancelled).toBe(true);
        expect(s.run!.status).toBe('cancelled');
        expect(s.reviews).toHaveLength(0);
        expect(s.trace).toBeUndefined();
      }
    }
  });

  // ---- guarded terminal writes ---------------------------------------------

  it('R11: recordRunFailed moves running → failed; buffer trace keeps cost null', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);

    expect(await recordRunFailed(db(), runId, { durationMs: 5, error: 'boom' })).toBe('transitioned');
    expect(await insertRunTraceIfAbsent(db(), runId, traceDoc(null))).toBe(true);

    const s = await state(runId, pr.id);
    expect(s.run).toMatchObject({ status: 'failed', error: 'boom', durationMs: 5, tokensIn: 0 });
    expect(s.trace!.stats).toHaveProperty('cost_usd', null);
  });

  it('R12: recordRunFailed never touches a done run or its trace', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    await finalizeDoneRun(db(), input(runId, pr.id));

    expect(await recordRunFailed(db(), runId, { durationMs: 5, error: 'late' })).toBe('noop');
    expect(await insertRunTraceIfAbsent(db(), runId, traceDoc(null))).toBe(false);

    const s = await state(runId, pr.id);
    expect(s.run).toMatchObject({ status: 'done', error: null, tokensIn: 100 });
    expect(s.trace!.stats.cost_usd).toBe(0.001);
  });

  it('R13: recordRunFailed leaves a cancelled run cancelled', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    await cancelRunIfRunning(db(), runId);

    expect(await recordRunFailed(db(), runId, { durationMs: 5, error: 'boom' })).toBe('noop');
    expect((await state(runId, pr.id)).run!.status).toBe('cancelled');
  });

  it('R14: recordRunCancelled — transition, annotate once, never touch done', async () => {
    const pr = await newPr();

    const running = await newRun(pr.id);
    expect(await recordRunCancelled(db(), running, { durationMs: 7 })).toBe('transitioned');
    expect((await state(running, pr.id)).run).toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });

    const userCancelled = await newRun(pr.id);
    await cancelRunIfRunning(db(), userCancelled);
    expect((await state(userCancelled, pr.id)).run).toMatchObject({ error: null, durationMs: null });
    expect(await recordRunCancelled(db(), userCancelled, { durationMs: 7 })).toBe('annotated');
    expect((await state(userCancelled, pr.id)).run).toMatchObject({
      status: 'cancelled',
      error: 'Cancelled by user',
      durationMs: 7,
    });
    expect(await recordRunCancelled(db(), userCancelled, { durationMs: 99 })).toBe('noop');
    expect((await state(userCancelled, pr.id)).run!.durationMs).toBe(7);

    const done = await newRun(pr.id);
    await finalizeDoneRun(db(), input(done, pr.id));
    expect(await recordRunCancelled(db(), done, { durationMs: 7 })).toBe('noop');
    expect((await state(done, pr.id)).run).toMatchObject({ status: 'done', error: null });
  });

  it('R15: insertRunTraceIfAbsent never replaces an existing trace', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    expect(await insertRunTraceIfAbsent(db(), runId, traceDoc(0.5))).toBe(true);
    expect(await insertRunTraceIfAbsent(db(), runId, traceDoc(null))).toBe(false);
    expect((await state(runId, pr.id)).trace!.stats.cost_usd).toBe(0.5);
  });

  it('R16: insertRunTraceIfAbsent for a deleted run rejects (FK) — callers must catch', async () => {
    const pr = await newPr();
    const runId = await newRun(pr.id);
    await deleteAgentRun(db(), workspaceId, runId);
    await expect(insertRunTraceIfAbsent(db(), runId, traceDoc(null))).rejects.toThrow();
  });
});
