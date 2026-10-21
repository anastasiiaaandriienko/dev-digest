import { and, asc, eq, sql } from 'drizzle-orm';
import type { PrBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Brief data-access: the PR (workspace-scoped), its STORED files (path and line
 * counts only — never `patch`, AC-BRIEF-03) and the `pr_brief` row. `pr_brief` has
 * no workspace column, so the service always resolves the PR through `getPull`
 * (workspace-scoped) before touching the row.
 */

export interface BriefPull {
  id: string;
  title: string;
  body: string | null;
  headSha: string;
}

export interface BriefFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface BriefRow {
  prId: string;
  json: unknown;
}

export interface SaveBriefValues {
  prId: string;
  brief: PrBrief;
}

/**
 * Upsert guard (A7), two parts, both required:
 *  1. head check: the incoming `meta.head_sha` must equal the PR's CURRENT
 *     `pull_requests.head_sha` (correlated subquery on `pr_id`);
 *  2. same-head ordering: stored meta missing, OR stored head differs, OR stored
 *     `generated_at` is NULL / not later than the incoming one (fixed-width ISO strings).
 * Columns are spelled out because inside ON CONFLICT … DO UPDATE an unqualified
 * column is ambiguous between the target row and `excluded`.
 */
export const SAVE_BRIEF_WHERE = sql`(select "pull_requests"."head_sha" from "pull_requests" where "pull_requests"."id" = "pr_brief"."pr_id") = excluded."json"->'meta'->>'head_sha' AND ("pr_brief"."json"->'meta' IS NULL OR "pr_brief"."json"->'meta'->>'head_sha' IS DISTINCT FROM excluded."json"->'meta'->>'head_sha' OR "pr_brief"."json"->'meta'->>'generated_at' IS NULL OR "pr_brief"."json"->'meta'->>'generated_at' <= excluded."json"->'meta'->>'generated_at')`;

/** The conditional upsert as a (not yet executed) builder — unit tests read `.toSQL()`. */
export function buildSaveBriefQuery(db: Db, v: SaveBriefValues) {
  return db
    .insert(t.prBrief)
    .values({ prId: v.prId, json: v.brief })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: v.brief }, setWhere: SAVE_BRIEF_WHERE })
    .returning({ prId: t.prBrief.prId });
}

export class BriefRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        title: t.pullRequests.title,
        body: t.pullRequests.body,
        headSha: t.pullRequests.headSha,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.id, prId), eq(t.pullRequests.workspaceId, workspaceId)));
    return row;
  }

  /** Stored files WITHOUT `patch`, sorted by path. */
  async listFiles(prId: string): Promise<BriefFile[]> {
    return this.db
      .select({ path: t.prFiles.path, additions: t.prFiles.additions, deletions: t.prFiles.deletions })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
  }

  async getBriefRow(prId: string): Promise<BriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Guarded upsert. Returns true when the row was written, false when the guard
   * skipped it (the PR head moved on, or a newer same-head brief is stored).
   * The first insert has no conflict row, so the head check is a pre-check here.
   */
  async saveBrief(v: SaveBriefValues): Promise<boolean> {
    const [pull] = await this.db
      .select({ headSha: t.pullRequests.headSha })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, v.prId));
    if (!pull || pull.headSha !== v.brief.meta?.head_sha) return false;
    const rows = await buildSaveBriefQuery(this.db, v);
    return rows.length > 0;
  }
}
