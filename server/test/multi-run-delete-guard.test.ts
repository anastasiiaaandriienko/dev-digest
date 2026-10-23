import { describe, it, expect, vi, afterEach } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import { AppError } from '../src/platform/errors.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { runSourceQuery } from '../src/modules/reviews/repository/run.repo.js';
import { ReviewService } from '../src/modules/reviews/service.js';

/**
 * L07 T6 — DELETE /runs/:id refuses CI runs (AC-MAR-59). No DB: the repository
 * is spied, so these tests prove the guard runs before ANY delete call. That
 * the four related rows (run, trace, review/findings, ci_runs) really survive
 * in Postgres is the T12 integration test (S8).
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const RUN = '00000000-0000-4000-8000-000000000001';

/** `source` as the DB would answer for (workspace, run); undefined = no such run here. */
function setup(sourceFor: (workspaceId: string, runId: string) => 'local' | 'ci' | undefined) {
  const container = new Container(config(), {} as Db, { secrets: new MockSecretsProvider({}) });
  const getRunSource = vi
    .spyOn(ReviewRepository.prototype, 'getRunSource')
    .mockImplementation(async (ws, id) => sourceFor(ws, id));
  // The existing delete: true when a run of this workspace was removed.
  const deleteAgentRun = vi
    .spyOn(ReviewRepository.prototype, 'deleteAgentRun')
    .mockImplementation(async (ws, id) => sourceFor(ws, id) !== undefined);
  const deleteReview = vi.spyOn(ReviewRepository.prototype, 'deleteReview');
  return { service: new ReviewService(container), getRunSource, deleteAgentRun, deleteReview };
}

describe('ReviewService.deleteRun — CI delete guard (AC-MAR-59)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a CI run → 409 ci_run_not_deletable', async () => {
    const s = setup(() => 'ci');
    const err = await s.service.deleteRun('ws', RUN).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'ci_run_not_deletable', statusCode: 409 });
    expect(s.getRunSource).toHaveBeenCalledWith('ws', RUN);
  });

  it('a CI run: nothing is deleted — the only delete path (reviews → run → trace/ci_runs cascade) is never reached', async () => {
    const s = setup(() => 'ci');
    await s.service.deleteRun('ws', RUN).catch(() => undefined);
    expect(s.deleteAgentRun).not.toHaveBeenCalled();
    expect(s.deleteReview).not.toHaveBeenCalled();
  });

  it('a local run is deleted exactly as before (→ true, i.e. { ok: true })', async () => {
    const s = setup(() => 'local');
    await expect(s.service.deleteRun('ws', RUN)).resolves.toBe(true);
    expect(s.deleteAgentRun).toHaveBeenCalledTimes(1);
    expect(s.deleteAgentRun).toHaveBeenCalledWith('ws', RUN);
    // The source is checked first, then the existing delete runs.
    expect(s.getRunSource.mock.invocationCallOrder[0]).toBeLessThan(s.deleteAgentRun.mock.invocationCallOrder[0]!);
  });

  it('a run of another workspace reads as missing: the usual false ({ ok: false }), never a 409 that would reveal it', async () => {
    // The CI run exists, but only in workspace "other".
    const s = setup((ws) => (ws === 'other' ? 'ci' : undefined));
    await expect(s.service.deleteRun('ws', RUN)).resolves.toBe(false);
    expect(s.getRunSource).toHaveBeenCalledWith('ws', RUN);
  });

  it('a non-existent run: the usual false ({ ok: false }) and no 409', async () => {
    const s = setup(() => undefined);
    await expect(s.service.deleteRun('ws', RUN)).resolves.toBe(false);
  });
});

describe('runSourceQuery — workspace-scoped, read-only', () => {
  const db = drizzle(postgres('postgres://x:x@127.0.0.1:1/x'), { schema }) as unknown as Db;
  const { sql, params } = runSourceQuery(db, 'ws-1', RUN).toSQL();

  it('selects only the source, by run id AND workspace', () => {
    expect(sql).toBe(
      'select "source" from "agent_runs" where ("agent_runs"."id" = $1 and "agent_runs"."workspace_id" = $2) limit $3',
    );
    expect(params).toEqual([RUN, 'ws-1', 1]);
  });
});
