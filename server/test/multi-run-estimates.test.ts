import { describe, it, expect, vi, afterEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import {
  ESTIMATE_WINDOW,
  MultiRunRepository,
  type EstimateRunRow,
} from '../src/modules/reviews/multi-run/repository.js';
import { MultiRunService, aggregateEstimates } from '../src/modules/reviews/multi-run/service.js';

/**
 * L07 T5 — GET /multi-agent/estimates (AC-MAR-19, 56). The averaging is a pure
 * function and tested directly; the run selection (window, done, local,
 * workspace) is SQL and checked via `.toSQL()` here — its behaviour on a real
 * Postgres is covered by the T12 integration test. No DB, no network.
 */

const row = (agentId: string, rn: number | null, durationMs: number | null, costUsd: number | null): EstimateRunRow => ({
  agentId,
  rn,
  durationMs,
  costUsd,
});

describe('aggregateEstimates — formulas', () => {
  it('averages known durations and costs per agent', () => {
    expect(
      aggregateEstimates([row('a', 1, 1000, 0.01), row('a', 2, 2000, 0.03), row('a', 3, 3000, 0.02)]),
    ).toEqual([{ agent_id: 'a', runs: 3, avg_duration_ms: 2000, avg_cost_usd: 0.02 }]);
  });

  it('uses only the last ESTIMATE_WINDOW (10) runs — rn 1..10, newest first', () => {
    expect(ESTIMATE_WINDOW).toBe(10);
    // rn 1..10 take 1000 ms / $0.01; rn 11, 12 are old and much slower/more expensive.
    const rows = Array.from({ length: 12 }, (_, i) =>
      i < 10 ? row('a', i + 1, 1000, 0.01) : row('a', i + 1, 99_000, 9.99),
    );
    const [est] = aggregateEstimates(rows);
    expect(est).toMatchObject({ agent_id: 'a', runs: 10, avg_duration_ms: 1000 });
    expect(est!.avg_cost_usd).toBeCloseTo(0.01, 12); // float sum of ten 0.01, not 9.99-polluted
  });

  it('no history: the agent is listed with runs 0 and null averages (no invented estimate)', () => {
    expect(aggregateEstimates([row('new-agent', null, null, null)])).toEqual([
      { agent_id: 'new-agent', runs: 0, avg_duration_ms: null, avg_cost_usd: null },
    ]);
  });

  it('partially missing values: means over the known ones only; all unknown → null', () => {
    expect(
      aggregateEstimates([row('a', 1, 1000, null), row('a', 2, null, 0.04), row('a', 3, 3000, null)]),
    ).toEqual([{ agent_id: 'a', runs: 3, avg_duration_ms: 2000, avg_cost_usd: 0.04 }]);
    expect(aggregateEstimates([row('b', 1, 500, null), row('b', 2, 700, null)])).toEqual([
      { agent_id: 'b', runs: 2, avg_duration_ms: 600, avg_cost_usd: null },
    ]);
  });

  it('a zero cost is a known value (0 ≠ unknown) and durations round to whole ms', () => {
    expect(aggregateEstimates([row('a', 1, 1000, 0), row('a', 2, 1001, 0.02), row('a', 3, 1001, null)])).toEqual([
      { agent_id: 'a', runs: 3, avg_duration_ms: 1001, avg_cost_usd: 0.01 },
    ]);
  });

  it('keeps agents separate, in first-seen order', () => {
    const out = aggregateEstimates([row('x', 1, 100, 0.1), row('y', null, null, null), row('x', 2, 300, 0.3)]);
    expect(out.map((e) => [e.agent_id, e.runs, e.avg_duration_ms])).toEqual([
      ['x', 2, 200],
      ['y', 0, null],
    ]);
    expect(out[0]!.avg_cost_usd).toBeCloseTo(0.2, 10);
  });
});

describe('estimateRowsQuery — run selection (SQL)', () => {
  // A real Drizzle builder over a client that is never connected (toSQL only).
  const db = drizzle(postgres('postgres://x:x@127.0.0.1:1/x'), { schema }) as unknown as Db;
  const { sql: text, params } = new MultiRunRepository(db).estimateRowsQuery('ws-1').toSQL();

  it('one query: windowed recent runs LEFT JOINed onto the agents (no N+1, agents without runs kept)', () => {
    expect(text).toMatch(/^select .* from "agents" left join \(select /);
    expect(text.match(/select /g)).toHaveLength(2);
  });

  it('only done, local runs — CI and unfinished runs never count (AC-MAR-56)', () => {
    expect(text).toContain('"agent_runs"."status" = $2');
    expect(text).toContain('"agent_runs"."source" = $3');
    expect(params.slice(1, 3)).toEqual(['done', 'local']);
  });

  it('workspace isolation on both the runs and the agents', () => {
    expect(text).toContain('"agent_runs"."workspace_id" = $1');
    expect(text).toContain('where "agents"."workspace_id" = $5');
    expect([params[0], params[4]]).toEqual(['ws-1', 'ws-1']);
  });

  it('last 10 per agent, newest first (ran_at desc, id tie-break)', () => {
    expect(text).toContain(
      'row_number() over (partition by "agent_runs"."agent_id" order by "agent_runs"."ran_at" desc, "agent_runs"."id" desc)',
    );
    expect(text).toContain('"rn" <= $4');
    expect(params[3]).toBe(ESTIMATE_WINDOW);
  });

  it('cost comes from the run trace (null when unknown)', () => {
    expect(text).toContain(`("run_traces"."trace" -> 'stats' ->> 'cost_usd')::float8`);
    expect(text).toContain('left join "run_traces" on "run_traces"."run_id" = "agent_runs"."id"');
  });
});

describe('MultiRunRepository.estimateRows / MultiRunService.estimates', () => {
  afterEach(() => vi.restoreAllMocks());
  const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  it('normalises driver values (bigint/numeric strings → numbers, null stays null)', async () => {
    vi.spyOn(MultiRunRepository.prototype, 'estimateRowsQuery').mockReturnValue(
      Promise.resolve([
        { agentId: 'a', rn: '1', durationMs: 1200, costUsd: '0.015' },
        { agentId: 'b', rn: null, durationMs: null, costUsd: null },
      ]) as unknown as ReturnType<MultiRunRepository['estimateRowsQuery']>,
    );
    const rows = await new MultiRunRepository({} as Db).estimateRows('ws');
    expect(rows).toEqual([
      { agentId: 'a', rn: 1, durationMs: 1200, costUsd: 0.015 },
      { agentId: 'b', rn: null, durationMs: null, costUsd: null },
    ]);
  });

  it('the service scopes the query to the caller workspace and returns the estimates', async () => {
    const estimateRows = vi
      .spyOn(MultiRunRepository.prototype, 'estimateRows')
      .mockResolvedValue([row('a', 1, 2000, 0.02), row('b', null, null, null)]);
    const container = new Container(config(), {} as Db, { secrets: new MockSecretsProvider({}) });
    const out = await new MultiRunService(container).estimates('ws-7');
    expect(estimateRows).toHaveBeenCalledWith('ws-7');
    expect(out).toEqual([
      { agent_id: 'a', runs: 1, avg_duration_ms: 2000, avg_cost_usd: 0.02 },
      { agent_id: 'b', runs: 0, avg_duration_ms: null, avg_cost_usd: null },
    ]);
  });
});
