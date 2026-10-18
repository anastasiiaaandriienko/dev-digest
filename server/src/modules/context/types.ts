/**
 * Ports of the Project Context module. The service and the run executor depend
 * on these interfaces only; the Drizzle implementation arrives with the
 * attachment tables (T6b). Tests inject an in-memory store through
 * `ContainerOverrides.contextStore`.
 *
 * Every method is scoped by `workspaceId`: an id of another workspace behaves
 * like a missing row.
 */

export type ContextOwnerKind = 'agent' | 'skill';

export interface ContextRepoRef {
  id: string;
  /** Clone worktree root, or null while the repo is not cloned. */
  clonePath: string | null;
}

/** A stored attachment: ids + repo-relative path + order. Never document text. */
export interface ContextAttachmentRow {
  id: string;
  ownerId: string;
  repoId: string;
  path: string;
  order: number;
}

export interface NewContextAttachment {
  workspaceId: string;
  owner: ContextOwnerKind;
  ownerId: string;
  repoId: string;
  /** Already normalized. The store assigns `order` (max + 1). */
  path: string;
}

/** What a review run needs to build its Project Context block. */
export interface ProjectContextInput {
  /** Saved roots of the repo, or null when it has none (defaults apply). */
  roots: string[] | null;
  /** Rows attached to the agent for this repo, in `order`. */
  agent: ContextAttachmentRow[];
  /** Rows per skill, in the order of `skillIds` given to `loadForRun`. */
  skills: { skillId: string; rows: ContextAttachmentRow[] }[];
}

/** The slice of the store used while a review runs (optional executor dependency). */
export interface ProjectContextSource {
  loadForRun(args: {
    workspaceId: string;
    repoId: string;
    agentId: string;
    skillIds: readonly string[];
  }): Promise<ProjectContextInput>;
}

export interface ContextStore extends ProjectContextSource {
  getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRef | null>;
  /** True when the agent exists in the workspace. */
  hasAgent(workspaceId: string, agentId: string): Promise<boolean>;
  /** True when the skill exists in the workspace. */
  hasSkill(workspaceId: string, skillId: string): Promise<boolean>;

  getRoots(workspaceId: string, repoId: string): Promise<string[] | null>;
  /** Replaces the repo's roots; keeps exactly one roots row. */
  saveRoots(workspaceId: string, repoId: string, roots: string[]): Promise<void>;

  listAttachments(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachmentRow[]>;
  /** Idempotent per (owner, repo, path): an existing row is returned with `created: false`. */
  insertAttachment(input: NewContextAttachment): Promise<{ row: ContextAttachmentRow; created: boolean }>;
  /** Removes one row of this owner; false when there is none. */
  deleteAttachment(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    docId: string,
  ): Promise<boolean>;
}
