import type { Skill, SkillCreate, SkillRestoreResult, SkillUpdate, SkillVersion } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';
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

  /** Body history, newest first; the snapshot of the live version has `current: true`. */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[]> {
    const found = await this.repo.listVersions(workspaceId, id);
    if (!found) throw new NotFoundError('Skill not found');
    return found.versions.map((v) => toSkillVersionDto(v, found.currentVersion));
  }

  /** Bring back an old body as a new version (no-op when it is already current). */
  async restoreVersion(workspaceId: string, id: string, version: number): Promise<SkillRestoreResult> {
    const outcome = await this.repo.restoreVersion(workspaceId, id, version);
    if (outcome.kind === 'skill_missing') throw new NotFoundError('Skill not found');
    if (outcome.kind === 'version_missing') throw new NotFoundError(`Skill version ${version} not found`);
    return {
      skill: await this.get(workspaceId, id),
      restored: outcome.kind === 'restored',
      restored_from: version,
    };
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (!ok) throw new NotFoundError('Skill not found');
  }
}
