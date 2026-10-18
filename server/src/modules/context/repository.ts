import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  ContextAttachmentRow,
  ContextOwnerKind,
  ContextRepoRef,
  ContextStore,
  NewContextAttachment,
  ProjectContextInput,
} from './types.js';
import { planRootsUpsert, rootsKey } from './helpers.js';

/** Table + owner column of an attachment kind (the two tables share their shape). */
function target(owner: ContextOwnerKind) {
  return owner === 'agent'
    ? { table: t.agentContextDocs, ownerCol: t.agentContextDocs.agentId }
    : { table: t.skillContextDocs, ownerCol: t.skillContextDocs.skillId };
}

type DocRow = { id: string; repoId: string; path: string; order: number };

function toRow(ownerId: string, r: DocRow): ContextAttachmentRow {
  return { id: r.id, ownerId, repoId: r.repoId, path: r.path, order: r.order };
}

/**
 * Drizzle implementation of `ContextStore`. Every query is filtered by
 * `workspace_id`; the constructor does not touch the database.
 */
export class ContextRepository implements ContextStore {
  constructor(private readonly db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRef | null> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .limit(1);
    return row ?? null;
  }

  async hasAgent(workspaceId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .limit(1);
    return !!row;
  }

  async hasSkill(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)))
      .limit(1);
    return !!row;
  }

  async getRoots(workspaceId: string, repoId: string): Promise<string[] | null> {
    const [row] = await this.db
      .select({ value: t.settings.value })
      .from(t.settings)
      .where(
        and(
          eq(t.settings.workspaceId, workspaceId),
          isNull(t.settings.userId),
          eq(t.settings.key, rootsKey(repoId)),
        ),
      )
      .orderBy(asc(t.settings.id))
      .limit(1);
    return rootsFromValue(row?.value);
  }

  async saveRoots(workspaceId: string, repoId: string, roots: string[]): Promise<void> {
    const key = rootsKey(repoId);
    await this.db.transaction(async (tx) => {
      // NULL user_id defeats the settings unique index, so serialize writers by hand.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${workspaceId}:${key}`}))`);
      const existing = await tx
        .select({ id: t.settings.id })
        .from(t.settings)
        .where(
          and(
            eq(t.settings.workspaceId, workspaceId),
            isNull(t.settings.userId),
            eq(t.settings.key, key),
          ),
        )
        .orderBy(asc(t.settings.id));
      const plan = planRootsUpsert(existing.map((r) => r.id));
      if (plan.updateId) {
        await tx
          .update(t.settings)
          .set({ value: roots })
          .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.id, plan.updateId)));
      }
      if (plan.deleteIds.length > 0) {
        await tx
          .delete(t.settings)
          .where(and(eq(t.settings.workspaceId, workspaceId), inArray(t.settings.id, plan.deleteIds)));
      }
      if (plan.insert) {
        await tx.insert(t.settings).values({ workspaceId, userId: null, key, value: roots });
      }
    });
  }

  async listAttachments(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachmentRow[]> {
    const { table, ownerCol } = target(owner);
    const rows = await this.db
      .select({ id: table.id, repoId: table.repoId, path: table.path, order: table.order })
      .from(table)
      .where(and(eq(table.workspaceId, workspaceId), eq(ownerCol, ownerId), eq(table.repoId, repoId)))
      .orderBy(asc(table.order), asc(table.createdAt));
    return rows.map((r) => toRow(ownerId, r));
  }

  async insertAttachment(
    input: NewContextAttachment,
  ): Promise<{ row: ContextAttachmentRow; created: boolean }> {
    const { workspaceId, owner, ownerId, repoId, path } = input;
    const { table, ownerCol } = target(owner);
    const nextOrder = sql<number>`(select coalesce(max(${table.order}), 0) + 1 from ${table} where ${table.workspaceId} = ${workspaceId} and ${ownerCol} = ${ownerId} and ${table.repoId} = ${repoId})`;
    const values =
      owner === 'agent'
        ? { workspaceId, agentId: ownerId, repoId, path, order: nextOrder }
        : { workspaceId, skillId: ownerId, repoId, path, order: nextOrder };
    const inserted = await this.db.transaction(async (tx) => {
      // max+1 is racy without serialization; lock per (workspace, owner kind, owner, repo).
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${workspaceId}:${owner}:${ownerId}:${repoId}`}))`,
      );
      return tx
        .insert(table)
        .values(values as never)
        .onConflictDoNothing()
        .returning({ id: table.id, repoId: table.repoId, path: table.path, order: table.order });
    });
    if (inserted[0]) return { row: toRow(ownerId, inserted[0]), created: true };

    const [existing] = await this.db
      .select({ id: table.id, repoId: table.repoId, path: table.path, order: table.order })
      .from(table)
      .where(
        and(
          eq(table.workspaceId, workspaceId),
          eq(ownerCol, ownerId),
          eq(table.repoId, repoId),
          eq(table.path, path),
        ),
      )
      .limit(1);
    if (!existing) throw new Error('context attachment insert conflicted but no row was found');
    return { row: toRow(ownerId, existing), created: false };
  }

  async deleteAttachment(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    docId: string,
  ): Promise<boolean> {
    const { table, ownerCol } = target(owner);
    const deleted = await this.db
      .delete(table)
      .where(and(eq(table.workspaceId, workspaceId), eq(ownerCol, ownerId), eq(table.id, docId)))
      .returning({ id: table.id });
    return deleted.length > 0;
  }

  async loadForRun(args: {
    workspaceId: string;
    repoId: string;
    agentId: string;
    skillIds: readonly string[];
  }): Promise<ProjectContextInput> {
    const { workspaceId, repoId, agentId, skillIds } = args;
    const roots = await this.getRoots(workspaceId, repoId);
    const agent = await this.listAttachments(workspaceId, 'agent', agentId, repoId);

    const bySkill = new Map<string, ContextAttachmentRow[]>();
    if (skillIds.length > 0) {
      const rows = await this.db
        .select({
          id: t.skillContextDocs.id,
          skillId: t.skillContextDocs.skillId,
          repoId: t.skillContextDocs.repoId,
          path: t.skillContextDocs.path,
          order: t.skillContextDocs.order,
        })
        .from(t.skillContextDocs)
        .where(
          and(
            eq(t.skillContextDocs.workspaceId, workspaceId),
            eq(t.skillContextDocs.repoId, repoId),
            inArray(t.skillContextDocs.skillId, [...skillIds]),
          ),
        )
        .orderBy(asc(t.skillContextDocs.order), asc(t.skillContextDocs.createdAt));
      for (const r of rows) {
        const list = bySkill.get(r.skillId) ?? [];
        list.push(toRow(r.skillId, r));
        bySkill.set(r.skillId, list);
      }
    }
    return {
      roots,
      agent,
      skills: skillIds.map((skillId) => ({ skillId, rows: bySkill.get(skillId) ?? [] })),
    };
  }
}

/** Saved roots value → string[]; anything else counts as "no saved roots". */
function rootsFromValue(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : null;
}
