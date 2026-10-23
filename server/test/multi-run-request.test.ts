import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RunRequest } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { MAX_AGENTS_PER_RUN } from '../src/modules/reviews/multi-run/constants.js';
import { isAgentId, normalizeAgentIds } from '../src/modules/reviews/multi-run/helpers.js';
import { MultiRunRepository } from '../src/modules/reviews/multi-run/repository.js';
import { agentRow, pullRow, repoRow } from './helpers/run-cost-fixtures.js';

/**
 * L07 T3 — starting a multi-agent run (AC-MAR-01..04, 53). No DB, no LLM: the
 * repositories and the executor are spied; the transaction is a fake that
 * records inserts. Real rollback/ordering in Postgres is covered by T12.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function expectInvalid(body: RunRequest) {
  let err: unknown;
  try {
    normalizeAgentIds(body);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe('invalid_run_request');
  expect((err as AppError).statusCode).toBe(400);
}

describe('normalizeAgentIds (AC-MAR-03)', () => {
  it('returns null for legacy bodies so the old path is used unchanged', () => {
    expect(normalizeAgentIds({})).toBeNull();
    expect(normalizeAgentIds({ agentId: uuid(1) })).toBeNull();
    expect(normalizeAgentIds({ all: true })).toBeNull();
  });

  it('drops duplicates keeping the first occurrence (list order = column order)', () => {
    expect(normalizeAgentIds({ agentIds: [uuid(3), uuid(1), uuid(3), uuid(2), uuid(1)] })).toEqual([
      uuid(3),
      uuid(1),
      uuid(2),
    ]);
  });

  it('accepts 1..8 distinct ids, counting after de-duplication', () => {
    expect(normalizeAgentIds({ agentIds: [uuid(1)] })).toEqual([uuid(1)]);
    const eight = Array.from({ length: MAX_AGENTS_PER_RUN }, (_, i) => uuid(i + 1));
    expect(normalizeAgentIds({ agentIds: [...eight, uuid(1), uuid(2)] })).toEqual(eight);
  });

  it('rejects an empty list and more than 8 distinct ids with 400 invalid_run_request', () => {
    expect(MAX_AGENTS_PER_RUN).toBe(8);
    expectInvalid({ agentIds: [] });
    expectInvalid({ agentIds: Array.from({ length: 9 }, (_, i) => uuid(i + 1)) });
  });

  it('rejects agentIds combined with agentId or all (any value)', () => {
    expectInvalid({ agentIds: [uuid(1)], agentId: uuid(2) });
    expectInvalid({ agentIds: [uuid(1)], all: true });
    expectInvalid({ agentIds: [uuid(1)], all: false });
  });

  it('isAgentId accepts uuids only', () => {
    expect(isAgentId(uuid(1))).toBe(true);
    expect(isAgentId('not-a-uuid')).toBe(false);
    expect(isAgentId("1'; drop table agents;--")).toBe(false);
  });
});

/** Fake Drizzle db: `transaction(cb)` runs cb with a tx that records inserts. */
function fakeDb(opts: { shuffleChildren?: boolean; failChildren?: boolean } = {}) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const tx = {
    insert(table: unknown) {
      return {
        values(values: unknown) {
          return {
            async returning() {
              inserts.push({ table, values });
              if (table === t.multiAgentRuns) return [{ id: 'parent-1' }];
              if (opts.failChildren) throw new Error('insert agent_runs failed');
              const rows = (values as { agentId: string }[]).map((v, i) => ({ id: `run-${i}`, agentId: v.agentId }));
              return opts.shuffleChildren ? rows.reverse() : rows;
            },
          };
        },
      };
    },
  };
  let transactions = 0;
  const db = {
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      transactions++;
      return cb(tx);
    },
  };
  return { db: db as unknown as Db, inserts, transactions: () => transactions };
}

describe('MultiRunRepository.createMultiRun (AC-MAR-01, 53)', () => {
  const agents = [1, 2, 3].map((n) => ({ id: uuid(n), provider: 'openai', model: `m${n}` }));

  it('writes the parent and every child inside ONE transaction, children linked, running, local', async () => {
    const f = fakeDb();
    const t0 = new Date('2026-10-23T10:00:00.000Z');
    const out = await new MultiRunRepository(f.db).createMultiRun({
      workspaceId: 'ws',
      prId: 'pr',
      agents,
      startedAt: t0,
    });

    expect(f.transactions()).toBe(1);
    expect(f.inserts.map((i) => i.table)).toEqual([t.multiAgentRuns, t.agentRuns]);
    expect(f.inserts[0]!.values).toEqual({ workspaceId: 'ws', prId: 'pr', ranAt: t0 });
    const children = f.inserts[1]!.values as Record<string, unknown>[];
    expect(children.map((c) => c.agentId)).toEqual(agents.map((a) => a.id));
    for (const c of children) {
      expect(c).toMatchObject({
        workspaceId: 'ws',
        prId: 'pr',
        status: 'running',
        source: 'local',
        multiAgentRunId: 'parent-1',
      });
    }
    expect(out).toEqual({ multiAgentRunId: 'parent-1', runIds: ['run-0', 'run-1', 'run-2'] });
  });

  it('gives children ran_at = t0 + i ms so column order follows the list (A-T1)', async () => {
    const f = fakeDb();
    const t0 = new Date('2026-10-23T10:00:00.000Z');
    await new MultiRunRepository(f.db).createMultiRun({ workspaceId: 'ws', prId: 'pr', agents, startedAt: t0 });
    const children = f.inserts[1]!.values as { ranAt: Date }[];
    expect(children.map((c) => c.ranAt.getTime() - t0.getTime())).toEqual([0, 1, 2]);
  });

  it('maps run ids back by agent, not by RETURNING order', async () => {
    const f = fakeDb({ shuffleChildren: true });
    const out = await new MultiRunRepository(f.db).createMultiRun({ workspaceId: 'ws', prId: 'pr', agents });
    expect(out.runIds).toEqual(['run-0', 'run-1', 'run-2']);
  });

  it('propagates a child-insert failure out of the transaction (Postgres then rolls back the parent)', async () => {
    const f = fakeDb({ failChildren: true });
    await expect(
      new MultiRunRepository(f.db).createMultiRun({ workspaceId: 'ws', prId: 'pr', agents }),
    ).rejects.toThrow('insert agent_runs failed');
    expect(f.transactions()).toBe(1);
  });

  it('refuses an empty agent list', async () => {
    const f = fakeDb();
    await expect(
      new MultiRunRepository(f.db).createMultiRun({ workspaceId: 'ws', prId: 'pr', agents: [] }),
    ).rejects.toThrow('no agents');
    expect(f.transactions()).toBe(0);
  });
});

describe('ReviewService — start a multi-agent run (AC-MAR-01/02) and the legacy path (AC-MAR-04)', () => {
  afterEach(() => vi.restoreAllMocks());

  const agentsById = new Map([1, 2, 3].map((n) => [uuid(n), agentRow({ id: uuid(n), name: `Agent ${n}` })]));

  function setup(o: { pull?: boolean; repo?: boolean; createMultiRun?: () => Promise<{ multiAgentRunId: string; runIds: string[] }> } = {}) {
    const container = new Container(config(), {} as Db, { secrets: new MockSecretsProvider({}) });
    const getById = vi
      .spyOn(AgentsRepository.prototype, 'getById')
      .mockImplementation(async (_ws, id) => agentsById.get(id));
    const getPull = vi
      .spyOn(ReviewRepository.prototype, 'getPull')
      .mockResolvedValue(o.pull === false ? undefined : pullRow());
    const getRepo = vi
      .spyOn(ReviewRepository.prototype, 'getRepo')
      .mockResolvedValue(o.repo === false ? undefined : repoRow());
    const createAgentRun = vi
      .spyOn(ReviewRepository.prototype, 'createAgentRun')
      .mockImplementation(async (v) => `legacy-run-${v.agentId}`);
    const createMultiRun = vi
      .spyOn(MultiRunRepository.prototype, 'createMultiRun')
      .mockImplementation(
        o.createMultiRun ??
          (async ({ agents }) => ({ multiAgentRunId: 'multi-1', runIds: agents.map((a) => `run-${a.id}`) })),
      );
    const executeRuns = vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockResolvedValue(undefined);
    return { service: new ReviewService(container), getById, getPull, getRepo, createAgentRun, createMultiRun, executeRuns };
  }

  it('validates, creates the multi-run atomically and launches the runs in list order', async () => {
    const s = setup();
    const order = [uuid(3), uuid(1), uuid(2)];
    const out = await s.service.runMultiAgentReview('ws', pullRow().id, order);

    expect(s.getById.mock.calls.map((c) => c[1])).toEqual(order);
    expect(s.createMultiRun).toHaveBeenCalledTimes(1);
    expect(s.createMultiRun.mock.calls[0]![0]).toMatchObject({ workspaceId: 'ws', prId: pullRow().id });
    expect(s.createMultiRun.mock.calls[0]![0].agents.map((a) => a.id)).toEqual(order);
    expect(out.multiAgentRunId).toBe('multi-1');
    expect(out.runs).toEqual(
      order.map((id) => ({ run_id: `run-${id}`, agent_id: id, agent_name: agentsById.get(id)!.name })),
    );
    expect(out.reviews).toEqual([]);
    expect(s.executeRuns).toHaveBeenCalledTimes(1);
    const jobs = s.executeRuns.mock.calls[0]![3];
    expect(jobs.map((j) => [j.agent.id, j.runId])).toEqual(order.map((id) => [id, `run-${id}`]));
    expect(s.createAgentRun).not.toHaveBeenCalled(); // no legacy per-row inserts
  });

  it('starts execution only after the transaction has committed', async () => {
    let commit!: () => void;
    const s = setup({
      createMultiRun: () =>
        new Promise((resolve) => {
          commit = () => resolve({ multiAgentRunId: 'multi-1', runIds: ['r1'] });
        }),
    });
    const pending = s.service.runMultiAgentReview('ws', pullRow().id, [uuid(1)]);
    await vi.waitFor(() => expect(s.createMultiRun).toHaveBeenCalled());
    expect(s.executeRuns).not.toHaveBeenCalled();
    commit();
    await pending;
    expect(s.executeRuns).toHaveBeenCalledTimes(1);
  });

  it('a failed transaction surfaces the error and launches nothing', async () => {
    const s = setup({ createMultiRun: async () => Promise.reject(new Error('tx rolled back')) });
    await expect(s.service.runMultiAgentReview('ws', pullRow().id, [uuid(1), uuid(2)])).rejects.toThrow(
      'tx rolled back',
    );
    expect(s.executeRuns).not.toHaveBeenCalled();
  });

  it('AC-MAR-02: an agent outside the workspace → 404 before any write', async () => {
    const s = setup();
    const err = await s.service.runMultiAgentReview('ws', pullRow().id, [uuid(1), uuid(9)]).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).statusCode).toBe(404);
    expect(s.createMultiRun).not.toHaveBeenCalled();
    expect(s.executeRuns).not.toHaveBeenCalled();
  });

  it('a malformed agent id → 404 without querying it (A-T2)', async () => {
    const s = setup();
    const err = await s.service.runMultiAgentReview('ws', pullRow().id, [uuid(1), 'not-a-uuid']).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(s.getById.mock.calls.map((c) => c[1])).toEqual([uuid(1)]);
    expect(s.createMultiRun).not.toHaveBeenCalled();
  });

  it('a PR outside the workspace (or its repo missing) → 404 before any write', async () => {
    for (const o of [{ pull: false }, { repo: false }]) {
      const s = setup(o);
      const err = await s.service.runMultiAgentReview('ws', pullRow().id, [uuid(1)]).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect(s.createMultiRun).not.toHaveBeenCalled();
      expect(s.executeRuns).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
  });

  it('AC-MAR-04: the legacy path still creates one plain run per target and no multi-run', async () => {
    const s = setup();
    const targets = [agentRow({ id: uuid(1), name: 'Agent 1' }), agentRow({ id: uuid(2), name: 'Agent 2' })];
    const out = await s.service.runReview('ws', pullRow().id, targets);

    expect(s.createAgentRun).toHaveBeenCalledTimes(2);
    expect(s.createMultiRun).not.toHaveBeenCalled();
    expect(out.runs).toEqual([
      { run_id: `legacy-run-${uuid(1)}`, agent_id: uuid(1), agent_name: 'Agent 1' },
      { run_id: `legacy-run-${uuid(2)}`, agent_id: uuid(2), agent_name: 'Agent 2' },
    ]);
    expect(s.executeRuns).toHaveBeenCalledTimes(1);
  });
});
