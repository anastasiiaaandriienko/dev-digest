import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ConventionSkillCreate, ConventionStatus, ConventionUpdate } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow, SkillRow } from '../../db/rows.js';
import { fingerprintRule, type GroundedCandidate } from './helpers.js';

/** The repo fields a scan needs, scoped to the workspace. */
export interface ScanRepo {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export type CreateSkillOutcome =
  | { kind: 'created'; skill: SkillRow; attachedAgentId: string | null }
  | { kind: 'name_taken'; name: string }
  | { kind: 'agent_missing' };

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Data access for `convention_scans` + `conventions` (and the skill created
 * from them). Every query is scoped by `workspaceId`.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<ScanRepo | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)))
      .orderBy(desc(t.conventionScans.startedAt), desc(t.conventionScans.id))
      .limit(1);
    return row;
  }

  /** Insert a `running` scan; null when one is already running for this repo (partial unique index). */
  async startScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | null> {
    try {
      const [row] = await this.db.insert(t.conventionScans).values({ workspaceId, repoId, status: 'running' }).returning();
      return row!;
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) return null;
      throw err;
    }
  }

  async updateScan(scanId: string, values: Partial<Omit<ConventionScanRow, 'id' | 'workspaceId' | 'repoId'>>): Promise<void> {
    await this.db.update(t.conventionScans).set(values).where(eq(t.conventionScans.id, scanId));
  }

  async failScan(scanId: string, error: string): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error: error.slice(0, 1000), finishedAt: new Date() })
      .where(and(eq(t.conventionScans.id, scanId), eq(t.conventionScans.status, 'running')));
  }

  /** On boot: a scan still `running` lost its process; candidates and decisions are untouched. */
  async reapRunningScans(): Promise<number> {
    const rows = await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error: 'Interrupted: the server restarted during the scan', finishedAt: new Date() })
      .where(eq(t.conventionScans.status, 'running'))
      .returning({ id: t.conventionScans.id });
    return rows.length;
  }

  /** Most recent rejected rules of the repo, for the "do not propose again" prompt list. */
  async rejectedRules(workspaceId: string, repoId: string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ rule: t.conventions.rule })
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId), eq(t.conventions.status, 'rejected')))
      .orderBy(desc(t.conventions.updatedAt))
      .limit(limit);
    return rows.map((r) => r.rule);
  }

  /**
   * Store a successful scan's candidates and close the scan, in ONE transaction:
   *  - accepted / rejected rows are never touched (a candidate whose fingerprint
   *    already exists is skipped: rejected stays rejected, accepted stays accepted);
   *  - pending rows from earlier scans that nobody touched are replaced; pending
   *    rows the user edited are kept;
   *  - nothing here runs for a failed scan, so old candidates survive failures.
   * Returns how many new rows were inserted.
   */
  async completeScan(
    workspaceId: string,
    repoId: string,
    scanId: string,
    candidates: readonly GroundedCandidate[],
    scan: Partial<ConventionScanRow>,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, repoId),
            eq(t.conventions.status, 'pending'),
            sql`${t.conventions.updatedAt} = ${t.conventions.createdAt}`,
            sql`${t.conventions.scanId} is distinct from ${scanId}`,
          ),
        );
      // Rows from before 0011 whose fingerprint stayed NULL (normalized duplicates) can't
      // conflict in the unique index; match them by fingerprinting their rule here.
      const legacy = await tx
        .select({ rule: t.conventions.rule })
        .from(t.conventions)
        .where(
          and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId), sql`${t.conventions.fingerprint} is null`),
        );
      const legacyPrints = new Set(legacy.map((l) => fingerprintRule(l.rule)));
      const fresh = candidates.filter((c) => !legacyPrints.has(c.fingerprint));
      let added = 0;
      if (fresh.length > 0) {
        const rows = await tx
          .insert(t.conventions)
          .values(
            fresh.map((c) => ({
              workspaceId,
              repoId,
              scanId,
              rule: c.rule,
              category: c.category,
              evidencePath: c.evidencePath,
              evidenceLine: c.evidenceLine,
              evidenceSnippet: c.evidenceSnippet,
              confidence: c.confidence,
              status: 'pending' as const,
              accepted: false,
              fingerprint: c.fingerprint,
            })),
          )
          .onConflictDoNothing({ target: [t.conventions.workspaceId, t.conventions.repoId, t.conventions.fingerprint] })
          .returning({ id: t.conventions.id });
        added = rows.length;
      }
      await tx
        .update(t.conventionScans)
        .set({ ...scan, status: 'done', candidatesAdded: added, finishedAt: new Date() })
        .where(eq(t.conventionScans.id, scanId));
      return added;
    });
  }

  async list(workspaceId: string, repoId: string, statuses: readonly ConventionStatus[]): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId), inArray(t.conventions.status, [...statuses])),
      )
      .orderBy(sql`${t.conventions.confidence} desc nulls last`, asc(t.conventions.createdAt), asc(t.conventions.id));
  }

  async counts(workspaceId: string, repoId: string): Promise<Record<ConventionStatus, number>> {
    const rows = await this.db
      .select({ status: t.conventions.status, n: sql<number>`count(*)::int` })
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .groupBy(t.conventions.status);
    const out = { pending: 0, accepted: 0, rejected: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  /** Decide / edit one candidate; `accepted` follows `status`. undefined = not in this workspace. */
  async update(workspaceId: string, id: string, patch: ConventionUpdate): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status, accepted: patch.status === 'accepted' } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async accepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.list(workspaceId, repoId, ['accepted']);
  }

  /**
   * Create the skill built from conventions (source `extracted`) with its
   * version-1 row, and optionally link it to an agent of the SAME workspace
   * (enabled, last in its prompt) — all in one transaction. The workspace's
   * skill-name lock (shared with skill import) makes the "name taken" check
   * and the insert atomic against other imports / conventions skills.
   */
  async createSkill(workspaceId: string, input: ConventionSkillCreate, evidenceFiles: string[]): Promise<CreateSkillOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`skills:${workspaceId}`}, 0))`);
      const [taken] = await tx
        .select({ name: t.skills.name })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), sql`lower(${t.skills.name}) = ${input.name.toLowerCase()}`))
        .limit(1);
      if (taken) return { kind: 'name_taken', name: taken.name } as const;

      let agentId: string | null = null;
      if (input.agent_id) {
        const [agent] = await tx
          .select({ id: t.agents.id })
          .from(t.agents)
          .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, input.agent_id)))
          .for('update');
        if (!agent) return { kind: 'agent_missing' } as const;
        agentId = agent.id;
      }

      const [skill] = await tx
        .insert(t.skills)
        .values({
          workspaceId,
          name: input.name,
          description: input.description,
          type: input.type,
          source: 'extracted',
          body: input.body,
          enabled: input.enabled,
          version: 1,
          evidenceFiles: evidenceFiles.length > 0 ? evidenceFiles : null,
        })
        .returning();
      await tx.insert(t.skillVersions).values({ skillId: skill!.id, version: 1, body: skill!.body });

      if (agentId) {
        const [last] = await tx
          .select({ next: sql<number>`coalesce(max(${t.agentSkills.order}) + 1, 0)::int` })
          .from(t.agentSkills)
          .where(eq(t.agentSkills.agentId, agentId));
        await tx.insert(t.agentSkills).values({ agentId, skillId: skill!.id, order: last?.next ?? 0, enabled: true });
      }
      return { kind: 'created', skill: skill!, attachedAgentId: agentId } as const;
    });
  }
}
