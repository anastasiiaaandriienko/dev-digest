import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SkillCreate, SkillImportItem, SkillUpdate } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import { bodyChanged, toUpdateValues } from './helpers.js';

/** A skill row with the number of same-workspace agents it is linked to. */
export interface SkillWithCount {
  row: SkillRow;
  agentCount: number;
}

/** Result of `restoreVersion` (the service maps the misses to 404). */
export type RestoreOutcome =
  | { kind: 'skill_missing' }
  | { kind: 'version_missing' }
  | { kind: 'noop'; row: SkillRow }
  | { kind: 'restored'; row: SkillRow };

/**
 * Data access for `skills` + `skill_versions`. Every query is scoped by
 * `workspaceId`; writes that touch both tables run in one transaction.
 */
export class SkillsRepository {
  constructor(private db: Db) {}

  /**
   * Skills of the workspace with their agent_count: links (agent_skills) to
   * agents of the SAME workspace only, aggregated in a grouped subquery and
   * LEFT JOINed (a correlated subquery would be ambiguous: Drizzle renders
   * `skills.id` unqualified there, so it would bind to `agents.id`).
   */
  private selectWithCount(workspaceId: string) {
    const counts = this.db
      .select({
        skillId: t.agentSkills.skillId,
        n: sql<number>`count(*)::int`.as('n'),
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(eq(t.agents.workspaceId, workspaceId))
      .groupBy(t.agentSkills.skillId)
      .as('agent_counts');
    return this.db
      .select({ row: t.skills, agentCount: sql<number>`coalesce(${counts.n}, 0)::int` })
      .from(t.skills)
      .leftJoin(counts, eq(counts.skillId, t.skills.id));
  }

  async list(workspaceId: string): Promise<SkillWithCount[]> {
    return this.selectWithCount(workspaceId)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(desc(t.skills.createdAt), desc(t.skills.id));
  }

  async getById(workspaceId: string, id: string): Promise<SkillWithCount | undefined> {
    const [row] = await this.selectWithCount(workspaceId).where(
      and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)),
    );
    return row;
  }

  /** Insert the skill at version 1 and its first `skill_versions` row, atomically. */
  async create(workspaceId: string, input: SkillCreate): Promise<SkillRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.skills)
        .values({
          workspaceId,
          name: input.name,
          description: input.description,
          type: input.type,
          source: input.source,
          body: input.body,
          enabled: input.enabled,
          version: 1,
          evidenceFiles: input.evidence_files ?? null,
        })
        .returning();
      await tx.insert(t.skillVersions).values({ skillId: row!.id, version: 1, body: row!.body });
      return row!;
    });
  }

  /** Existing skill names of the workspace among `names`, compared case-insensitively. */
  async takenNames(workspaceId: string, names: readonly string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const lower = names.map((n) => n.toLowerCase());
    const rows = await this.db
      .select({ name: t.skills.name })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(sql`lower(${t.skills.name})`, lower)));
    return rows.map((r) => r.name);
  }

  /**
   * Create imported skills (source `imported`, disabled, version 1 + its
   * version row), all or nothing. A per-workspace advisory lock serializes
   * imports, so two concurrent imports cannot both pass the name check and
   * create the same name. Returns the names already taken instead of writing.
   * Scope: only imports take the lock; manual create / rename never enforced
   * unique names and still don't (a DB-level unique index would need a migration).
   */
  async createImported(
    workspaceId: string,
    items: readonly SkillImportItem[],
  ): Promise<{ kind: 'created'; rows: SkillRow[] } | { kind: 'conflict'; names: string[] }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`skills:${workspaceId}`}, 0))`);
      const lower = items.map((i) => i.name.toLowerCase());
      const taken = await tx
        .select({ name: t.skills.name })
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), inArray(sql`lower(${t.skills.name})`, lower)));
      if (taken.length > 0) return { kind: 'conflict', names: taken.map((r) => r.name) } as const;

      const rows = await tx
        .insert(t.skills)
        .values(
          items.map((i) => ({
            workspaceId,
            name: i.name,
            description: i.description,
            type: i.type,
            source: 'imported' as const,
            body: i.body,
            enabled: false, // untrusted until a human reviews and enables it
            version: 1,
            evidenceFiles: null,
          })),
        )
        .returning();
      await tx.insert(t.skillVersions).values(rows.map((r) => ({ skillId: r.id, version: 1, body: r.body })));
      return { kind: 'created', rows } as const;
    });
  }

  /**
   * Apply a patch. The row is locked (`FOR UPDATE`) so concurrent edits cannot
   * both claim the same next version; a changed body bumps `version` and appends
   * a `skill_versions` row in the same transaction. undefined = not found.
   */
  async update(workspaceId: string, id: string, patch: SkillUpdate): Promise<SkillRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!current) return undefined;

      const values = toUpdateValues(current, patch);
      // e.g. only `body` sent and identical to the stored one: nothing to write.
      if (Object.keys(values).length === 0) return current;
      const [row] = await tx
        .update(t.skills)
        .set(values)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();
      if (bodyChanged(current, patch)) {
        await tx.insert(t.skillVersions).values({ skillId: id, version: row!.version, body: row!.body });
      }
      return row!;
    });
  }

  /**
   * Body history of a skill, newest first, with the skill's current version.
   * undefined = no such skill in this workspace (versions are only reachable
   * through a workspace-scoped skill).
   */
  async listVersions(
    workspaceId: string,
    id: string,
  ): Promise<{ currentVersion: number; versions: SkillVersionRow[] } | undefined> {
    // ONE statement (skills LEFT JOIN skill_versions) so `current` and the list
    // come from the same snapshot even while a restore commits concurrently.
    const rows = await this.db
      .select({ currentVersion: t.skills.version, snapshot: t.skillVersions })
      .from(t.skills)
      .leftJoin(t.skillVersions, eq(t.skillVersions.skillId, t.skills.id))
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .orderBy(desc(t.skillVersions.version));
    if (rows.length === 0) return undefined;
    return {
      currentVersion: rows[0]!.currentVersion,
      versions: rows.flatMap((r) => (r.snapshot ? [r.snapshot] : [])),
    };
  }

  /**
   * Restore version `version`'s body as a NEW version (history is never
   * rewritten). Same lock as `update`, so a concurrent edit or restore cannot
   * claim the same next version. Only `body` and `version` change; name,
   * description, type, enabled and evidence are left as they are. If that body
   * is already current, nothing is written.
   */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<RestoreOutcome> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .for('update');
      if (!current) return { kind: 'skill_missing' } as const;

      const [snapshot] = await tx
        .select()
        .from(t.skillVersions)
        .where(and(eq(t.skillVersions.skillId, id), eq(t.skillVersions.version, version)));
      if (!snapshot) return { kind: 'version_missing' } as const;

      const values = toUpdateValues(current, { body: snapshot.body });
      if (Object.keys(values).length === 0) return { kind: 'noop', row: current } as const;

      const [row] = await tx
        .update(t.skills)
        .set(values)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
        .returning();
      await tx.insert(t.skillVersions).values({ skillId: id, version: row!.version, body: row!.body });
      return { kind: 'restored', row: row! } as const;
    });
  }

  /** Delete; `skill_versions` and `agent_skills` rows go with it (FK cascade). */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }
}
