import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Pulls data-access for the read-only PR lookup (GET /pulls). Workspace-scoped;
 * reads stored rows only — never syncs from GitHub.
 */

export interface RepoMatch {
  id: string;
  fullName: string;
}

export interface PullMatch {
  id: string;
  number: number;
  title: string;
  status: string;
  repoId: string;
  repoFullName: string;
}

export interface PullFilter {
  number?: number;
  /** Case-insensitive substring of the title (LIKE wildcards are escaped). */
  title?: string;
  /** Restrict to these repositories. */
  repoIds?: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape `%`, `_` and `\` so user input is matched literally by (I)LIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export class PullsRepository {
  constructor(private db: Db) {}

  /**
   * Repositories a `repo` reference names: a repo uuid, `owner/name`
   * (case-insensitive) or a bare repo name (case-insensitive, may match several).
   */
  async findRepos(workspaceId: string, ref: string): Promise<RepoMatch[]> {
    const where: SQL = UUID_RE.test(ref)
      ? eq(t.repos.id, ref)
      : ref.includes('/')
        ? sql`lower(${t.repos.fullName}) = lower(${ref})`
        : sql`lower(${t.repos.name}) = lower(${ref})`;
    return this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), where))
      .orderBy(asc(t.repos.fullName));
  }

  /** Stored PRs matching every given filter, at most `limit` rows. */
  async findPulls(workspaceId: string, filter: PullFilter, limit: number): Promise<PullMatch[]> {
    const conditions: SQL[] = [eq(t.pullRequests.workspaceId, workspaceId), eq(t.repos.workspaceId, workspaceId)];
    if (filter.number !== undefined) conditions.push(eq(t.pullRequests.number, filter.number));
    if (filter.title !== undefined) conditions.push(ilike(t.pullRequests.title, `%${escapeLike(filter.title)}%`));
    if (filter.repoIds) conditions.push(inArray(t.pullRequests.repoId, filter.repoIds));
    return this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        status: t.pullRequests.status,
        repoId: t.repos.id,
        repoFullName: t.repos.fullName,
      })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(...conditions))
      .orderBy(asc(t.repos.fullName), desc(t.pullRequests.number))
      .limit(limit);
  }
}
