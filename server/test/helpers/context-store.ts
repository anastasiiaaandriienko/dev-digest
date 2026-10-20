import { randomUUID } from 'node:crypto';
import type {
  ContextAttachmentRow,
  ContextOwnerKind,
  ContextRepoRef,
  ContextStore,
  NewContextAttachment,
  ProjectContextInput,
} from '../../src/modules/context/types.js';

interface StoredRow extends ContextAttachmentRow {
  workspaceId: string;
  owner: ContextOwnerKind;
}

/**
 * In-memory ContextStore for unit tests. Mirrors the scoping contract: every
 * lookup is filtered by workspace. `inserts` records the exact write shape.
 */
export class InMemoryContextStore implements ContextStore {
  repos = new Map<string, ContextRepoRef & { workspaceId: string }>();
  agents = new Set<string>();
  skills = new Set<string>();
  roots = new Map<string, string[]>();
  rows: StoredRow[] = [];
  /** Every input passed to `insertAttachment`, as received. */
  inserts: NewContextAttachment[] = [];
  /** Number of `saveRoots` calls. */
  rootsSaves = 0;
  failLoad = false;
  /** Number of usageByPath calls. */
  usageCalls = 0;
  /** Agents / skills registered as disabled (only via the optional enabled argument). */
  disabledAgents = new Set<string>();
  disabledSkills = new Set<string>();
  /** agent_skills links; the agent and the skill are matched per workspace at query time. */
  links: { agentId: string; skillId: string; enabled: boolean }[] = [];

  private key = (workspaceId: string, id: string) => `${workspaceId}:${id}`;

  addRepo(workspaceId: string, id: string, clonePath: string | null): void {
    this.repos.set(this.key(workspaceId, id), { id, clonePath, workspaceId });
  }
  addAgent(workspaceId: string, id: string, enabled = true): void {
    this.agents.add(this.key(workspaceId, id));
    if (!enabled) this.disabledAgents.add(this.key(workspaceId, id));
  }
  addSkill(workspaceId: string, id: string, enabled = true): void {
    this.skills.add(this.key(workspaceId, id));
    if (!enabled) this.disabledSkills.add(this.key(workspaceId, id));
  }
  /** agent_skills row (no workspace column, like the table). */
  linkSkill(agentId: string, skillId: string, enabled = true): void {
    this.links.push({ agentId, skillId, enabled });
  }
  setRoots(workspaceId: string, repoId: string, roots: string[]): void {
    this.roots.set(this.key(workspaceId, repoId), roots);
  }

  async getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRef | null> {
    const r = this.repos.get(this.key(workspaceId, repoId));
    return r ? { id: r.id, clonePath: r.clonePath } : null;
  }
  async hasAgent(workspaceId: string, agentId: string): Promise<boolean> {
    return this.agents.has(this.key(workspaceId, agentId));
  }
  async hasSkill(workspaceId: string, skillId: string): Promise<boolean> {
    return this.skills.has(this.key(workspaceId, skillId));
  }
  async getRoots(workspaceId: string, repoId: string): Promise<string[] | null> {
    const r = this.roots.get(this.key(workspaceId, repoId));
    return r ? [...r] : null;
  }
  async saveRoots(workspaceId: string, repoId: string, roots: string[]): Promise<void> {
    this.rootsSaves += 1;
    this.roots.set(this.key(workspaceId, repoId), [...roots]);
  }

  private owned(workspaceId: string, owner: ContextOwnerKind, ownerId: string, repoId?: string): StoredRow[] {
    return this.rows
      .filter(
        (r) =>
          r.workspaceId === workspaceId &&
          r.owner === owner &&
          r.ownerId === ownerId &&
          (repoId === undefined || r.repoId === repoId),
      )
      .sort((a, b) => a.order - b.order);
  }

  private strip(r: StoredRow): ContextAttachmentRow {
    return { id: r.id, ownerId: r.ownerId, repoId: r.repoId, path: r.path, order: r.order };
  }

  async listAttachments(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    repoId: string,
  ): Promise<ContextAttachmentRow[]> {
    return this.owned(workspaceId, owner, ownerId, repoId).map((r) => this.strip(r));
  }

  async insertAttachment(
    input: NewContextAttachment,
  ): Promise<{ row: ContextAttachmentRow; created: boolean }> {
    this.inserts.push(input);
    const same = this.owned(input.workspaceId, input.owner, input.ownerId, input.repoId);
    const existing = same.find((r) => r.path === input.path);
    if (existing) return { row: this.strip(existing), created: false };
    const row: StoredRow = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      owner: input.owner,
      ownerId: input.ownerId,
      repoId: input.repoId,
      path: input.path,
      order: same.reduce((m, r) => Math.max(m, r.order), -1) + 1,
    };
    this.rows.push(row);
    return { row: this.strip(row), created: true };
  }

  async reorderAttachments(input: {
    workspaceId: string;
    owner: ContextOwnerKind;
    ownerId: string;
    repoId: string;
    ids: readonly string[];
  }): Promise<ContextAttachmentRow[] | null> {
    const mine = this.owned(input.workspaceId, input.owner, input.ownerId, input.repoId);
    const have = new Set(mine.map((r) => r.id));
    if (have.size !== input.ids.length || !input.ids.every((id) => have.has(id))) return null;
    input.ids.forEach((id, i) => {
      const row = mine.find((r) => r.id === id)!;
      row.order = i + 1;
    });
    return this.owned(input.workspaceId, input.owner, input.ownerId, input.repoId).map((r) => this.strip(r));
  }

  async deleteAttachment(
    workspaceId: string,
    owner: ContextOwnerKind,
    ownerId: string,
    docId: string,
  ): Promise<boolean> {
    const hit = this.owned(workspaceId, owner, ownerId).find((r) => r.id === docId);
    if (!hit) return false;
    this.rows = this.rows.filter((r) => r !== hit);
    return true;
  }

  /** Same rules as ContextRepository.usageByPath; rows come back unsorted on purpose. */
  async usageByPath(workspaceId: string, repoId: string): Promise<{ path: string; agentCount: number }[]> {
    this.usageCalls += 1;
    const agentsByPath = new Map<string, Set<string>>();
    const add = (path: string, agentId: string) => {
      const set = agentsByPath.get(path) ?? new Set<string>();
      set.add(agentId);
      agentsByPath.set(path, set);
    };
    for (const r of this.rows) {
      if (r.workspaceId !== workspaceId || r.repoId !== repoId) continue;
      if (r.owner === 'agent') {
        if (this.agents.has(this.key(workspaceId, r.ownerId))) add(r.path, r.ownerId);
        continue;
      }
      if (!this.skills.has(this.key(workspaceId, r.ownerId))) continue;
      if (this.disabledSkills.has(this.key(workspaceId, r.ownerId))) continue;
      for (const link of this.links) {
        if (link.skillId !== r.ownerId || !link.enabled) continue;
        if (this.agents.has(this.key(workspaceId, link.agentId))) add(r.path, link.agentId);
      }
    }
    return [...agentsByPath].map(([path, set]) => ({ path, agentCount: set.size })).reverse();
  }

  async loadForRun(args: {
    workspaceId: string;
    repoId: string;
    agentId: string;
    skillIds: readonly string[];
  }): Promise<ProjectContextInput> {
    if (this.failLoad) throw new Error('context store down');
    return {
      roots: await this.getRoots(args.workspaceId, args.repoId),
      agent: await this.listAttachments(args.workspaceId, 'agent', args.agentId, args.repoId),
      skills: await Promise.all(
        args.skillIds.map(async (skillId) => ({
          skillId,
          rows: await this.listAttachments(args.workspaceId, 'skill', skillId, args.repoId),
        })),
      ),
    };
  }
}
