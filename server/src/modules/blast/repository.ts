import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Blast data-access: the PR and its repo (workspace-scoped) plus the PR's
 * STORED changed files. Read-only — never syncs from GitHub; the index rows
 * themselves are read through `container.repoIntel`.
 */

export interface BlastPull {
  prId: string;
  repoId: string;
  repoFullName: string;
}

export class BlastRepository {
  constructor(private db: Db) {}

  async getPull(workspaceId: string, prId: string): Promise<BlastPull | null> {
    const [row] = await this.db
      .select({ prId: t.pullRequests.id, repoId: t.repos.id, repoFullName: t.repos.fullName })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(
        and(
          eq(t.pullRequests.id, prId),
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.repos.workspaceId, workspaceId),
        ),
      );
    return row ?? null;
  }

  /** Paths of the PR's stored files (pr_files), sorted. */
  async listChangedFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .orderBy(asc(t.prFiles.path));
    return [...new Set(rows.map((r) => r.path))];
  }
}
