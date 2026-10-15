import type { Skill, SkillCreate, SkillUpdate } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { toSkillDto } from './helpers.js';
import { SkillsRepository } from './repository.js';

/**
 * Skills Lab — CRUD use-cases over the workspace's skills. A skill is a Markdown
 * rule set; every body change is kept in `skill_versions` (version 1 on create).
 */
export class SkillsService {
  private repo: SkillsRepository;

  constructor(container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map((r) => toSkillDto(r.row, r.agentCount));
  }

  async get(workspaceId: string, id: string): Promise<Skill> {
    const found = await this.repo.getById(workspaceId, id);
    if (!found) throw new NotFoundError('Skill not found');
    return toSkillDto(found.row, found.agentCount);
  }

  async create(workspaceId: string, input: SkillCreate): Promise<Skill> {
    const row = await this.repo.create(workspaceId, input);
    return toSkillDto(row, 0); // a brand-new skill is not linked to any agent
  }

  async update(workspaceId: string, id: string, patch: SkillUpdate): Promise<Skill> {
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Skill not found');
    return this.get(workspaceId, row.id); // re-read for the current agent_count
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (!ok) throw new NotFoundError('Skill not found');
  }
}
