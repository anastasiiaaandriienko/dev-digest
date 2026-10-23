import { and, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { CiTarget, RunTrace } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { saveRunTrace } from '../reviews/repository/run.repo.js';

/**
 * Export to CI data access (L07, specs/export-to-ci.md §6.4, §7, §8; migration
 * 0016). `ci_installations` has no workspace column: every query scopes through
 * `agents.workspace_id`. One agent per repo is an MVP rule enforced here
 * (G2), not by a DB constraint: the occupancy check and the upsert run in ONE
 * transaction holding an advisory lock keyed by the repo, so concurrent
 * exports — also from other API processes — cannot both install. No GitHub I/O
 * ever runs inside these transactions.
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiInstallationStatus = CiInstallationRow['status'];

/** An installation with its agent's name and its newest ingested run. */
export interface CiInstallationListRow {
  installation: CiInstallationRow;
  agentName: string;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
}

export interface UpsertInstallationInput {
  workspaceId: string;
  agentId: string;
  repo: string;
  targetType: CiTarget;
  agentVersion: number;
  /** The export PR (open_pr); null for a zip export. */
  prUrl: string | null;
}

export type UpsertInstallationResult =
  | { ok: true; created: boolean; installation: CiInstallationRow }
  /** Another agent of the workspace has a pending/active/error installation on the repo. */
  | { ok: false; reason: 'repo_has_agent'; occupiedBy: { agentId: string; agentName: string } }
  | { ok: false; reason: 'agent_not_found' };

/** A claimed automatic sync (TA4): both instants as Postgres text, for an exact compare-and-set. */
export interface CiSyncClaim {
  installationId: string;
  claimedAt: string;
  previous: string | null;
}

export interface CiRunInsert {
  installationId: string;
  githubRunId: number;
  githubRepoId: number;
  commitSha: string;
  prNumber: number | null;
  /** The Actions run URL. */
  githubUrl: string;
  ranAt: Date;
  /** `agent_runs.status`: 'done' with an artifact, 'failed' without (G1). */
  runStatus: 'done' | 'failed';
  /** `ci_runs.status` (CiRunStatus). */
  ciStatus: string;
  model: string | null;
  findingsCount: number | null;
  blockers: number | null;
  durationMs: number | null;
  costUsd: number | null;
  /** The imported PR, when the studio has it; else null. */
  prId: string | null;
  /** A valid RunTrace with the extra `ci` object (TA2). */
  trace: RunTrace;
}

export type CiRunInsertResult =
  | { inserted: true; agentRunId: string; ciRunId: string }
  | { inserted: false; reason: 'duplicate' | 'installation_not_found' };

/** Default automatic-sync throttle (§7, AC-CI-55). */
export const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000;

class DuplicateCiRun extends Error {}

const repoLock = (repo: string) => sql`select pg_advisory_xact_lock(hashtextextended(${`ci_repo:${repo}`}, 0))`;

export class CiRepository {
  constructor(private readonly db: Db) {}

  /** The workspace's installation by id (with its agent's workspace check). */
  async getInstallation(workspaceId: string, id: string): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(and(eq(t.ciInstallations.id, id), eq(t.agents.workspaceId, workspaceId)));
    return row?.installation;
  }

  /** Another agent's installation occupying `repo` in this workspace (G2: pending, active and error all occupy). */
  async findBlockingInstallation(
    workspaceId: string,
    repo: string,
    targetType: CiTarget,
    exceptAgentId: string,
    db: Db = this.db,
  ): Promise<{ agentId: string; agentName: string } | undefined> {
    const [row] = await db
      .select({ agentId: t.agents.id, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.ciInstallations.repo, repo),
          eq(t.ciInstallations.targetType, targetType),
          ne(t.ciInstallations.agentId, exceptAgentId),
          inArray(t.ciInstallations.status, ['pending', 'active', 'error']),
        ),
      )
      .orderBy(t.ciInstallations.installedAt)
      .limit(1);
    return row;
  }

  /**
   * Occupancy check + insert/update in one transaction under the repo lock
   * (G2, G5, AC-CI-32, 36, 37, 39). New → `pending`. Re-export of the same
   * agent updates its row: `active` stays `active`, `pending`/`error` →
   * `pending`; `agent_version`, `pr_url` and `updated_at` are refreshed.
   */
  upsertInstallationExclusive(input: UpsertInstallationInput): Promise<UpsertInstallationResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(repoLock(input.repo));
      const [agent] = await tx
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.id, input.agentId), eq(t.agents.workspaceId, input.workspaceId)));
      if (!agent) return { ok: false, reason: 'agent_not_found' } as const;

      const blocking = await this.findBlockingInstallation(
        input.workspaceId,
        input.repo,
        input.targetType,
        input.agentId,
        tx,
      );
      if (blocking) return { ok: false, reason: 'repo_has_agent', occupiedBy: blocking } as const;

      const [row] = await tx
        .insert(t.ciInstallations)
        .values({
          agentId: input.agentId,
          repo: input.repo,
          targetType: input.targetType,
          status: 'pending',
          agentVersion: input.agentVersion,
          prUrl: input.prUrl,
        })
        .onConflictDoUpdate({
          target: [t.ciInstallations.agentId, t.ciInstallations.repo, t.ciInstallations.targetType],
          set: {
            status: sql`case when ${t.ciInstallations.status} = 'active' then 'active' else 'pending' end`,
            agentVersion: input.agentVersion,
            prUrl: input.prUrl,
            updatedAt: sql`now()`,
          },
        })
        // xmax = 0 only for a freshly inserted row version.
        .returning({ ...getTableColumns(t.ciInstallations), created: sql<boolean>`(xmax = 0)` });
      const { created, ...installation } = row!;
      return { ok: true, created, installation } as const;
    });
  }

  /** The agent's installations (CI tab), newest first, with the last ingested run. */
  listForAgent(workspaceId: string, agentId: string): Promise<CiInstallationListRow[]> {
    return this.listWhere(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)));
  }

  /** Every installation on `repo` in the workspace (wizard occupancy, AC-CI-05, 86). */
  listForRepo(workspaceId: string, repo: string): Promise<CiInstallationListRow[]> {
    return this.listWhere(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.repo, repo)));
  }

  private async listWhere(where: ReturnType<typeof and>): Promise<CiInstallationListRow[]> {
    // Newest run per installation as a joined subquery (no correlated subquery,
    // server/INSIGHTS.md 2026-10-15).
    const lastRun = this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId], {
        installationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
      })
      .from(t.ciRuns)
      .orderBy(t.ciRuns.ciInstallationId, sql`${t.ciRuns.ranAt} desc nulls last`)
      .as('last_run');
    const rows = await this.db
      .select({
        installation: t.ciInstallations,
        agentName: t.agents.name,
        lastRunStatus: lastRun.status,
        lastRunAt: lastRun.ranAt,
      })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
      .leftJoin(lastRun, eq(lastRun.installationId, t.ciInstallations.id))
      .where(where)
      .orderBy(desc(t.ciInstallations.installedAt), t.ciInstallations.id);
    return rows.map((r) => ({
      installation: r.installation,
      agentName: r.agentName,
      lastRunStatus: r.lastRunStatus ?? null,
      lastRunAt: r.lastRunAt ?? null,
    }));
  }

  /**
   * TA4: atomically claim the workspace's due installations (`last_synced_at`
   * null or older than `intervalMs`) for an automatic sync, before any GitHub
   * call. The due-condition is on the updated row itself, so of two
   * concurrent claims only one matches (the second re-checks the committed row).
   */
  async claimForAutoSync(
    workspaceId: string,
    opts: { installationId?: string; intervalMs?: number } = {},
  ): Promise<CiSyncClaim[]> {
    const interval = opts.intervalMs ?? AUTO_SYNC_INTERVAL_MS;
    const only = opts.installationId ? sql`and c.id = ${opts.installationId}` : sql``;
    const rows = await this.db.execute<{ id: string; claimed: string; previous: string | null }>(sql`
      update ci_installations c
         set last_synced_at = now()
        from agents a, (select id, last_synced_at as prev from ci_installations) p
       where a.id = c.agent_id
         and a.workspace_id = ${workspaceId}
         and p.id = c.id
         and (c.last_synced_at is null or c.last_synced_at < now() - ${interval}::bigint * interval '1 millisecond')
         ${only}
      returning c.id, c.last_synced_at::text as claimed, p.prev::text as previous`);
    return rows.map((r) => ({ installationId: r.id, claimedAt: r.claimed, previous: r.previous }));
  }

  /**
   * TA4 recovery after a transient failure: put the previous `last_synced_at`
   * back, but only if the row still holds this claim (compare-and-set).
   * Returns false when something else changed it meanwhile.
   */
  async releaseAutoSyncClaim(claim: CiSyncClaim): Promise<boolean> {
    const rows = await this.db.execute<{ id: string }>(sql`
      update ci_installations
         set last_synced_at = ${claim.previous}::timestamptz
       where id = ${claim.installationId}
         and last_synced_at = ${claim.claimedAt}::timestamptz
      returning id`);
    return rows.length === 1;
  }

  /** A successful manual sync (AC-CI-88): `last_synced_at = now()`. */
  async markManualSynced(installationId: string): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ lastSyncedAt: sql`now()` })
      .where(eq(t.ciInstallations.id, installationId));
  }

  /** Status transition outside an ingest (e.g. → `error` on GitHub auth/404, AC-CI-58). */
  async setStatus(installationId: string, status: CiInstallationStatus): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ status, updatedAt: sql`now()` })
      .where(eq(t.ciInstallations.id, installationId));
  }

  /** Which of `githubRunIds` this installation already stored (skip before downloading). */
  async existingGithubRunIds(installationId: string, githubRunIds: readonly number[]): Promise<Set<number>> {
    if (githubRunIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: t.ciRuns.githubRunId })
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.ciInstallationId, installationId), inArray(t.ciRuns.githubRunId, [...githubRunIds])));
    return new Set(rows.map((r) => r.id).filter((id): id is number => id !== null));
  }

  /**
   * Store one ingested Actions run (AC-CI-44, 45, 58): `agent_runs`
   * (source='ci') + `run_traces` + `ci_runs`, and the installation → `active`,
   * all in one transaction. A run already stored for the installation (unique
   * installation + github_run_id, also under concurrent syncs) rolls the whole
   * transaction back and reports `duplicate` — never a second row.
   */
  async insertCiRun(input: CiRunInsert): Promise<CiRunInsertResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ agentId: t.ciInstallations.agentId, workspaceId: t.agents.workspaceId })
          .from(t.ciInstallations)
          .innerJoin(t.agents, eq(t.agents.id, t.ciInstallations.agentId))
          .where(eq(t.ciInstallations.id, input.installationId));
        if (!owner) return { inserted: false, reason: 'installation_not_found' } as const;

        const [run] = await tx
          .insert(t.agentRuns)
          .values({
            workspaceId: owner.workspaceId,
            agentId: owner.agentId,
            prId: input.prId,
            ranAt: input.ranAt,
            provider: 'openrouter',
            model: input.model,
            durationMs: input.durationMs,
            status: input.runStatus,
            source: 'ci',
            findingsCount: input.findingsCount,
            blockers: input.blockers,
          })
          .returning({ id: t.agentRuns.id });
        await saveRunTrace(tx, run!.id, input.trace);

        const [ciRun] = await tx
          .insert(t.ciRuns)
          .values({
            ciInstallationId: input.installationId,
            agentRunId: run!.id,
            prNumber: input.prNumber,
            ranAt: input.ranAt,
            status: input.ciStatus,
            findingsCount: input.findingsCount,
            costUsd: input.costUsd,
            githubUrl: input.githubUrl,
            source: 'ci',
            commitSha: input.commitSha,
            githubRunId: input.githubRunId,
            githubRepoId: input.githubRepoId,
          })
          .onConflictDoNothing({ target: [t.ciRuns.ciInstallationId, t.ciRuns.githubRunId] })
          .returning({ id: t.ciRuns.id });
        if (!ciRun) throw new DuplicateCiRun();

        await tx
          .update(t.ciInstallations)
          .set({ status: 'active', updatedAt: sql`now()` })
          .where(eq(t.ciInstallations.id, input.installationId));
        return { inserted: true, agentRunId: run!.id, ciRunId: ciRun.id } as const;
      });
    } catch (err) {
      if (err instanceof DuplicateCiRun) return { inserted: false, reason: 'duplicate' };
      throw err;
    }
  }
}
