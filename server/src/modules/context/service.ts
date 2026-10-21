import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ContextAttachment,
  ContextAttachmentStatus,
  ContextFile,
  ContextList,
  ContextRoots,
  ContextUsage,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { MAX_ATTACHMENTS, SKIP_REASONS } from './constants.js';
import { walkDocs, type DiscoveryResult } from './discovery.js';
import { effectiveRoots, isUnderRoots, normalizeContextPath, queryValid, validateRoots } from './helpers.js';
import { checkDirChain, matchesQuery, readContextDoc } from './read.js';
import type { ContextAttachmentRow, ContextOwnerKind, ContextRepoRef, ContextStore } from './types.js';

/** Seams for tests: how docs are walked and read. */
export interface ContextServiceDeps {
  readDoc?: typeof readContextDoc;
  walk?: typeof walkDocs;
}

/**
 * Project Context folder (specs/project-context-folder): discover, search and
 * preview repo Markdown docs, edit the per-repo roots and attach docs to agents
 * and skills. Read-only towards the clone; attaching stores the path only.
 */
export class ContextService {
  private readDoc: typeof readContextDoc;
  private walk: typeof walkDocs;

  constructor(private container: Container, deps: ContextServiceDeps = {}) {
    this.readDoc = deps.readDoc ?? readContextDoc;
    this.walk = deps.walk ?? walkDocs;
  }

  /** Until the Drizzle store lands (T6b) there may be none: answer 503, never crash. */
  private store(): ContextStore {
    const store = this.container.contextStore;
    if (!store) throw new AppError('CONTEXT_UNAVAILABLE', 'Project context storage is not available', 503);
    return store;
  }

  private async repoOf(workspaceId: string, repoId: string): Promise<ContextRepoRef> {
    const repo = await this.store().getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /** Real path of the clone worktree, or null while the repo is not cloned. */
  private async cloneRootOf(repo: ContextRepoRef): Promise<string | null> {
    if (!repo.clonePath) return null;
    try {
      return await realpath(repo.clonePath);
    } catch {
      return null;
    }
  }

  private async requireCloneRoot(repo: ContextRepoRef): Promise<string> {
    const root = await this.cloneRootOf(repo);
    if (!root) throw new AppError('REPO_NOT_CLONED', 'Repository is not cloned', 409);
    return root;
  }

  private async rootsOf(workspaceId: string, repoId: string): Promise<string[]> {
    return effectiveRoots(await this.store().getRoots(workspaceId, repoId));
  }

  private normalized(path: string): string {
    const n = normalizeContextPath(path);
    if (!n.ok) throw new ValidationError('Invalid path', { reason: n.reason });
    return n.path;
  }

  // ---- roots ----

  async getRoots(workspaceId: string, repoId: string): Promise<ContextRoots> {
    await this.repoOf(workspaceId, repoId);
    return { roots: await this.rootsOf(workspaceId, repoId) };
  }

  async putRoots(workspaceId: string, repoId: string, input: readonly string[]): Promise<ContextRoots> {
    await this.repoOf(workspaceId, repoId);
    const checked = validateRoots(input);
    if (!checked.ok) throw new ValidationError('Invalid roots', { reason: checked.reason });
    await this.store().saveRoots(workspaceId, repoId, checked.roots);
    return { roots: checked.roots };
  }

  // ---- list / preview ----

  async list(workspaceId: string, repoId: string, q?: string): Promise<ContextList> {
    if (!queryValid(q)) throw new ValidationError('Invalid query', { reason: 'query too long' });
    const repo = await this.repoOf(workspaceId, repoId);
    const cloneRoot = await this.requireCloneRoot(repo);
    const roots = await this.rootsOf(workspaceId, repoId);
    const found = await this.walk(cloneRoot, roots);

    let files = found.files;
    if (q) {
      const kept: typeof files = [];
      for (const f of files) {
        const doc = await this.readDoc(cloneRoot, f.path);
        const hit = doc.kind === 'ok' ? matchesQuery(f.path, doc.text, q) : matchesQuery(f.path, '', q);
        if (hit) kept.push(f);
      }
      files = kept;
    }
    return {
      files: files.map((f) => ({ path: f.path, size: f.size, updated_at: f.updated_at })),
      roots,
      truncated: found.truncated,
      truncated_reasons: found.truncated_reasons,
    };
  }

  async preview(workspaceId: string, repoId: string, path: string): Promise<ContextFile> {
    const rel = this.normalized(path);
    const repo = await this.repoOf(workspaceId, repoId);
    const cloneRoot = await this.requireCloneRoot(repo);
    const found = await this.walk(cloneRoot, await this.rootsOf(workspaceId, repoId));
    if (!found.files.some((f) => f.path === rel)) throw new NotFoundError('Document not found');

    const doc = await this.readDoc(cloneRoot, rel);
    if (doc.kind === 'missing') throw new NotFoundError('Document not found');
    if (doc.kind === 'skip') throw new ValidationError('Document cannot be previewed', { reason: doc.reason });
    return { path: rel, content: doc.text, size: doc.size, updated_at: doc.updatedAt, truncated: doc.truncated };
  }

  // ---- usage ----

  /**
   * How many agents use each stored doc path in this repo. DB only: no clone,
   * no file read, no write. 404 for a foreign repo before any usage query.
   */
  async usage(workspaceId: string, repoId: string): Promise<ContextUsage> {
    await this.repoOf(workspaceId, repoId);
    const rows = await this.store().usageByPath(workspaceId, repoId);
    const items = rows
      .map((r) => ({ path: r.path, agent_count: r.agentCount }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { repo_id: repoId, items };
  }

  // ---- attachments ----

  private async requireOwner(workspaceId: string, kind: ContextOwnerKind, ownerId: string): Promise<void> {
    const store = this.store();
    const ok = kind === 'agent' ? await store.hasAgent(workspaceId, ownerId) : await store.hasSkill(workspaceId, ownerId);
    if (!ok) throw new NotFoundError(kind === 'agent' ? 'Agent not found' : 'Skill not found');
  }

  /** TA5: outside_roots if no root prefixes the path; ok if a regular file; else missing. */
  private async statusOf(
    path: string,
    roots: readonly string[],
    cloneRoot: string | null,
  ): Promise<ContextAttachmentStatus> {
    if (!isUnderRoots(path, roots)) return 'outside_roots';
    if (!cloneRoot) return 'missing';
    const segments = path.split('/');
    if ((await checkDirChain(cloneRoot, segments.slice(0, -1))) !== null) return 'missing';
    try {
      const st = await lstat(join(cloneRoot, ...segments));
      return st.isFile() ? 'ok' : 'missing';
    } catch {
      return 'missing';
    }
  }

  private async toDto(
    row: ContextAttachmentRow,
    roots: readonly string[],
    cloneRoot: string | null,
  ): Promise<ContextAttachment> {
    return {
      id: row.id,
      repo_id: row.repoId,
      path: row.path,
      order: row.order,
      status: await this.statusOf(row.path, roots, cloneRoot),
    };
  }

  async listAttachments(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachment[]> {
    await this.requireOwner(workspaceId, kind, ownerId);
    const repo = await this.repoOf(workspaceId, repoId);
    const rows = await this.store().listAttachments(workspaceId, kind, ownerId, repoId);
    const roots = await this.rootsOf(workspaceId, repoId);
    const cloneRoot = await this.cloneRootOf(repo);
    return Promise.all(rows.map((r) => this.toDto(r, roots, cloneRoot)));
  }

  /**
   * Attach a discovered doc. Stores ids + normalized path only; no content is
   * read. Re-attaching returns the existing row (`created: false`).
   */
  async attach(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    path: string,
  ): Promise<{ attachment: ContextAttachment; created: boolean }> {
    await this.requireOwner(workspaceId, kind, ownerId);
    const repo = await this.repoOf(workspaceId, repoId);
    const rel = this.normalized(path);
    const cloneRoot = await this.cloneRootOf(repo);
    if (!cloneRoot) throw new ValidationError('Repository is not cloned', { reason: SKIP_REASONS.repoNotCloned });

    const roots = await this.rootsOf(workspaceId, repoId);
    const found: DiscoveryResult = await this.walk(cloneRoot, roots);
    if (!found.files.some((f) => f.path === rel)) {
      throw new ValidationError('Document is not a discovered project doc', { reason: 'not discovered' });
    }

    const store = this.store();
    const existing = await store.listAttachments(workspaceId, kind, ownerId, repoId);
    if (!existing.some((r) => r.path === rel) && existing.length >= MAX_ATTACHMENTS) {
      throw new ValidationError('Attachment limit reached', { reason: 'attachment limit', limit: MAX_ATTACHMENTS });
    }
    const { row, created } = await store.insertAttachment({ workspaceId, owner: kind, ownerId, repoId, path: rel });
    return { attachment: await this.toDto(row, roots, cloneRoot), created };
  }

  /**
   * Set the full order of one owner's attachments for a repo. `ids` must be
   * exactly the attached set (checked by the store under its lock). Needs no
   * clone: statuses of a not-cloned repo come back as `missing`.
   */
  async reorder(
    workspaceId: string,
    kind: ContextOwnerKind,
    ownerId: string,
    repoId: string,
    ids: readonly string[],
  ): Promise<ContextAttachment[]> {
    await this.requireOwner(workspaceId, kind, ownerId);
    const repo = await this.repoOf(workspaceId, repoId);
    const rows = await this.store().reorderAttachments({ workspaceId, owner: kind, ownerId, repoId, ids });
    if (!rows) throw new ValidationError('ids must match the attached documents', { reason: 'reorder set mismatch' });
    const roots = await this.rootsOf(workspaceId, repoId);
    const cloneRoot = await this.cloneRootOf(repo);
    return Promise.all(rows.map((r) => this.toDto(r, roots, cloneRoot)));
  }

  async detach(workspaceId: string, kind: ContextOwnerKind, ownerId: string, docId: string): Promise<void> {
    await this.requireOwner(workspaceId, kind, ownerId);
    const ok = await this.store().deleteAttachment(workspaceId, kind, ownerId, docId);
    if (!ok) throw new NotFoundError('Attachment not found');
  }
}
