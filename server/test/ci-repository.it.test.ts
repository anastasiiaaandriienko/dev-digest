import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import type { RunTrace } from '@devdigest/shared';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { CiRepository, type CiRunInsert } from '../src/modules/ci/repository.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

/**
 * L07 B5 — CiRepository on a real Postgres (specs/export-to-ci.md §6.4, §7,
 * §8; G2, G5, TA4; AC-CI-32, 36, 37, 39, 44, 45, 55, 58, 87).
 *
 * Database:
 * - default: a disposable Testcontainers Postgres (skipped without Docker);
 * - DEVDIGEST_IT_DB_URL: an already-migrated database that MUST be named
 *   `devdigest_export_ci` (worktree B's isolated DB — anything else fails).
 *   The test then works only in workspaces it creates, deletes them at the
 *   end (cascade) and asserts every touched table is back to its row count.
 */

const EXTERNAL_DB = 'devdigest_export_ci';
const externalUrl = process.env.DEVDIGEST_IT_DB_URL;
if (externalUrl && new URL(externalUrl).pathname !== `/${EXTERNAL_DB}`) {
  throw new Error(`DEVDIGEST_IT_DB_URL must point at the isolated "${EXTERNAL_DB}" database`);
}
const enabled = externalUrl ? true : await dockerAvailable();
const d = enabled ? describe : describe.skip;

const TABLES = ['workspaces', 'agents', 'ci_installations', 'ci_runs', 'agent_runs', 'run_traces'] as const;

function trace(findings: number): RunTrace {
  return {
    config: { agent: 'CI agent', version: '3', provider: 'openrouter', model: 'openai/gpt-4.1', pr: 7, source: 'ci' },
    stats: { duration_ms: 1000, tokens_in: 0, tokens_out: 0, findings, grounding: 'ci', cost_usd: 0.01 },
    prompt_assembly: { system: '', user: '' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: [],
  };
}

d('CiRepository (real Postgres)', () => {
  let pg: PgFixture | undefined;
  let handle: DbHandle;
  let db: Db;
  let repo: CiRepository;
  const workspaces: string[] = [];
  let countsBefore: Record<string, number> = {};

  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
      out[table] = row!.n;
    }
    return out;
  };

  beforeAll(async () => {
    if (externalUrl) {
      handle = createDb(externalUrl, { max: 6 });
      const [col] = await handle.db.execute<{ n: number }>(
        sql`select count(*)::int as n from information_schema.columns where table_name = 'ci_installations' and column_name = 'last_synced_at'`,
      );
      if (col!.n !== 1) throw new Error(`${EXTERNAL_DB} is not migrated to 0016`);
    } else {
      pg = await startPg();
      handle = pg.handle;
    }
    db = handle.db;
    repo = new CiRepository(db);
    countsBefore = await counts();
  });

  afterAll(async () => {
    if (!db) return;
    if (workspaces.length > 0) await db.delete(t.workspaces).where(inArray(t.workspaces.id, workspaces));
    if (externalUrl) {
      // Everything this file created is gone again (workspace cascade).
      expect(await counts()).toEqual(countsBefore);
      await handle.close();
    } else {
      await pg?.stop();
    }
  });

  async function workspace(): Promise<string> {
    const [w] = await db.insert(t.workspaces).values({ name: `ci-it-${randomUUID()}` }).returning();
    workspaces.push(w!.id);
    return w!.id;
  }
  async function agent(workspaceId: string, name = `Agent ${randomUUID().slice(0, 8)}`) {
    const [a] = await db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openrouter', model: 'openai/gpt-4.1', systemPrompt: 'review' })
      .returning();
    return a!;
  }
  const repoName = () => `acme/ci-it-${randomUUID().slice(0, 8)}`;
  const install = (workspaceId: string, agentId: string, r: string, over: { prUrl?: string | null; agentVersion?: number } = {}) =>
    repo.upsertInstallationExclusive({
      workspaceId,
      agentId,
      repo: r,
      targetType: 'gha',
      agentVersion: over.agentVersion ?? 1,
      prUrl: over.prUrl === undefined ? 'https://github.com/acme/x/pull/1' : over.prUrl,
    });
  const rowsFor = (r: string) => db.select().from(t.ciInstallations).where(eq(t.ciInstallations.repo, r));

  describe('installations: create, re-export, occupancy (G2, G5)', () => {
    it('a first export inserts one pending row with version and PR url (AC-CI-32)', async () => {
      const ws = await workspace();
      const a = await agent(ws);
      const r = repoName();
      const res = await install(ws, a.id, r, { agentVersion: 3 });
      expect(res).toMatchObject({ ok: true, created: true });
      if (!res.ok) throw new Error('unreachable');
      expect(res.installation).toMatchObject({ agentId: a.id, repo: r, targetType: 'gha', status: 'pending', agentVersion: 3, prUrl: 'https://github.com/acme/x/pull/1', lastSyncedAt: null });
    });

    it('re-export of the same agent updates its one row: pending→pending, active stays active, error→pending (AC-CI-36)', async () => {
      const ws = await workspace();
      const a = await agent(ws);
      const r = repoName();
      const first = await install(ws, a.id, r);
      if (!first.ok) throw new Error('unreachable');

      const again = await install(ws, a.id, r, { agentVersion: 2, prUrl: 'https://github.com/acme/x/pull/2' });
      expect(again).toMatchObject({ ok: true, created: false, installation: { id: first.installation.id, status: 'pending', agentVersion: 2, prUrl: 'https://github.com/acme/x/pull/2' } });
      if (!again.ok) throw new Error('unreachable');
      expect(again.installation.updatedAt.getTime()).toBeGreaterThanOrEqual(first.installation.updatedAt.getTime());

      await repo.setStatus(first.installation.id, 'active');
      expect(await install(ws, a.id, r, { agentVersion: 3 })).toMatchObject({ ok: true, installation: { status: 'active', agentVersion: 3 } });

      await repo.setStatus(first.installation.id, 'error');
      expect(await install(ws, a.id, r)).toMatchObject({ ok: true, installation: { status: 'pending' } });
      expect(await rowsFor(r)).toHaveLength(1);
    });

    it('a zip re-export stores pr_url null (AC-CI-39)', async () => {
      const ws = await workspace();
      const a = await agent(ws);
      const r = repoName();
      await install(ws, a.id, r);
      expect(await install(ws, a.id, r, { prUrl: null })).toMatchObject({ ok: true, installation: { prUrl: null, status: 'pending' } });
    });

    it.each(['pending', 'active', 'error'] as const)('another agent’s %s installation occupies the repo: refused, nothing written (AC-CI-37)', async (status) => {
      const ws = await workspace();
      const owner = await agent(ws, `Owner ${status}`);
      const other = await agent(ws);
      const r = repoName();
      const first = await install(ws, owner.id, r);
      if (!first.ok) throw new Error('unreachable');
      await repo.setStatus(first.installation.id, status);

      expect(await install(ws, other.id, r)).toEqual({
        ok: false,
        reason: 'repo_has_agent',
        occupiedBy: { agentId: owner.id, agentName: `Owner ${status}` },
      });
      expect((await rowsFor(r)).map((x) => x.agentId)).toEqual([owner.id]);
    });

    it('occupancy is per workspace and per repo; an agent of another workspace is not found', async () => {
      const ws1 = await workspace();
      const ws2 = await workspace();
      const a1 = await agent(ws1);
      const a2 = await agent(ws2);
      const r = repoName();
      expect(await install(ws1, a1.id, r)).toMatchObject({ ok: true });
      expect(await install(ws2, a2.id, r)).toMatchObject({ ok: true });
      expect(await install(ws1, a1.id, repoName())).toMatchObject({ ok: true, created: true });
      expect(await install(ws1, a2.id, repoName())).toEqual({ ok: false, reason: 'agent_not_found' });
    });

    it('concurrent exports of six agents to one repo: exactly one installs (advisory lock)', async () => {
      const ws = await workspace();
      const agents = await Promise.all(Array.from({ length: 6 }, () => agent(ws)));
      const r = repoName();
      const results = await Promise.all(agents.map((a) => install(ws, a.id, r)));
      expect(results.filter((x) => x.ok)).toHaveLength(1);
      expect(results.filter((x) => !x.ok && x.reason === 'repo_has_agent')).toHaveLength(5);
      expect(await rowsFor(r)).toHaveLength(1);
    });

    it('concurrent re-exports of the same agent: one row, created exactly once', async () => {
      const ws = await workspace();
      const a = await agent(ws);
      const r = repoName();
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => install(ws, a.id, r, { agentVersion: i + 1 })));
      expect(results.every((x) => x.ok)).toBe(true);
      expect(results.filter((x) => x.ok && x.created)).toHaveLength(1);
      expect(await rowsFor(r)).toHaveLength(1);
    });
  });

  describe('CI runs: idempotent ingest (AC-CI-44, 45, 58)', () => {
    async function installed() {
      const ws = await workspace();
      const a = await agent(ws);
      const res = await install(ws, a.id, repoName());
      if (!res.ok) throw new Error('unreachable');
      return { ws, agent: a, installation: res.installation };
    }
    const run = (installationId: string, githubRunId: number, over: Partial<CiRunInsert> = {}): CiRunInsert => ({
      installationId,
      githubRunId,
      githubRepoId: 42,
      commitSha: 'a1b2c3d',
      prNumber: 7,
      githubUrl: `https://github.com/acme/x/actions/runs/${githubRunId}`,
      ranAt: new Date('2026-10-23T10:00:00Z'),
      runStatus: 'done',
      ciStatus: 'succeeded',
      model: 'openai/gpt-4.1',
      findingsCount: 2,
      blockers: 1,
      durationMs: 4200,
      costUsd: 0.01,
      prId: null,
      trace: trace(2),
      ...over,
    });

    it('stores agent_runs (source ci) + trace + ci_runs in one go and marks the installation active', async () => {
      const { ws, agent: a, installation } = await installed();
      const res = await repo.insertCiRun(run(installation.id, 123456789012));
      expect(res.inserted).toBe(true);
      if (!res.inserted) throw new Error('unreachable');

      const [ar] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, res.agentRunId));
      expect(ar).toMatchObject({ workspaceId: ws, agentId: a.id, source: 'ci', status: 'done', provider: 'openrouter', findingsCount: 2, blockers: 1, durationMs: 4200, prId: null, multiAgentRunId: null });
      const [tr] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, res.agentRunId));
      expect((tr!.trace as RunTrace).config.source).toBe('ci');
      const [cr] = await db.select().from(t.ciRuns).where(eq(t.ciRuns.id, res.ciRunId));
      expect(cr).toMatchObject({ ciInstallationId: installation.id, agentRunId: res.agentRunId, githubRunId: 123456789012, githubRepoId: 42, commitSha: 'a1b2c3d', prNumber: 7, status: 'succeeded', source: 'ci' });
      expect((await repo.getInstallation(ws, installation.id))!.status).toBe('active');
    });

    it('the same GitHub run twice → one row; the second reports duplicate and writes nothing', async () => {
      const { installation } = await installed();
      await repo.insertCiRun(run(installation.id, 77));
      const before = await counts();
      expect(await repo.insertCiRun(run(installation.id, 77))).toEqual({ inserted: false, reason: 'duplicate' });
      expect(await counts()).toEqual(before);
      expect(await repo.existingGithubRunIds(installation.id, [77, 78])).toEqual(new Set([77]));
    });

    it('concurrent syncs of one GitHub run store it once (no orphan agent_runs)', async () => {
      const { installation } = await installed();
      const before = await counts();
      const results = await Promise.all(Array.from({ length: 5 }, () => repo.insertCiRun(run(installation.id, 555))));
      expect(results.filter((x) => x.inserted)).toHaveLength(1);
      const after = await counts();
      expect(after.ci_runs - before.ci_runs).toBe(1);
      expect(after.agent_runs - before.agent_runs).toBe(1);
      expect(after.run_traces - before.run_traces).toBe(1);
    });

    it('an unknown installation is reported, nothing written', async () => {
      const before = await counts();
      expect(await repo.insertCiRun(run(randomUUID(), 1))).toEqual({ inserted: false, reason: 'installation_not_found' });
      expect(await counts()).toEqual(before);
    });

    it('lists show the newest run per installation, scoped to the workspace (AC-CI-62, 86)', async () => {
      const { ws, agent: a, installation } = await installed();
      await repo.insertCiRun(run(installation.id, 1, { ranAt: new Date('2026-10-23T09:00:00Z'), ciStatus: 'failed', runStatus: 'failed' }));
      await repo.insertCiRun(run(installation.id, 2, { ranAt: new Date('2026-10-23T11:00:00Z'), ciStatus: 'succeeded' }));
      const [row] = await repo.listForAgent(ws, a.id);
      expect(row).toMatchObject({ agentName: a.name, lastRunStatus: 'succeeded', installation: { id: installation.id } });
      expect(row!.lastRunAt!.toISOString()).toBe('2026-10-23T11:00:00.000Z');
      expect((await repo.listForRepo(ws, installation.repo)).map((x) => x.installation.id)).toEqual([installation.id]);
      expect(await repo.listForRepo(await workspace(), installation.repo)).toEqual([]);
      expect(await repo.listForAgent(await workspace(), a.id)).toEqual([]);
    });
  });

  describe('automatic sync claim (TA4, AC-CI-55, 87, 88)', () => {
    async function installed() {
      const ws = await workspace();
      const a = await agent(ws);
      const res = await install(ws, a.id, repoName());
      if (!res.ok) throw new Error('unreachable');
      return { ws, id: res.installation.id };
    }

    it('claims a never-synced installation once; a second claim within the interval gets nothing', async () => {
      const { ws, id } = await installed();
      const [claim] = await repo.claimForAutoSync(ws);
      expect(claim).toMatchObject({ installationId: id, previous: null });
      expect(claim!.claimedAt).toEqual(expect.any(String));
      expect(await repo.claimForAutoSync(ws)).toEqual([]);
      expect(await repo.claimForAutoSync(ws, { installationId: id })).toEqual([]);
    });

    it('concurrent automatic syncs: exactly one claim wins', async () => {
      const { ws, id } = await installed();
      const results = await Promise.all(Array.from({ length: 5 }, () => repo.claimForAutoSync(ws, { installationId: id })));
      expect(results.flat()).toHaveLength(1);
    });

    it('a transient failure releases the claim (compare-and-set) so the next sync retries', async () => {
      const { ws, id } = await installed();
      const [claim] = await repo.claimForAutoSync(ws);
      expect(await repo.releaseAutoSyncClaim(claim!)).toBe(true);
      expect((await repo.getInstallation(ws, id))!.lastSyncedAt).toBeNull();
      expect(await repo.claimForAutoSync(ws)).toHaveLength(1);
    });

    it('the release is a no-op when the row changed after the claim', async () => {
      const { ws, id } = await installed();
      const [claim] = await repo.claimForAutoSync(ws);
      await repo.markManualSynced(id);
      expect(await repo.releaseAutoSyncClaim(claim!)).toBe(false);
      expect((await repo.getInstallation(ws, id))!.lastSyncedAt).not.toBeNull();
    });

    it('an elapsed interval makes the installation due again, and the claim remembers the previous value', async () => {
      const { ws, id } = await installed();
      const [first] = await repo.claimForAutoSync(ws, { intervalMs: 0 });
      const [second] = await repo.claimForAutoSync(ws, { intervalMs: 0 });
      expect(second).toMatchObject({ installationId: id, previous: first!.claimedAt });
    });

    it('claims are scoped to the workspace', async () => {
      await installed();
      expect(await repo.claimForAutoSync(await workspace())).toEqual([]);
    });
  });
});
