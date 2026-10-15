import type { Skill, SkillSource, SkillType, SkillUpdate } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — row → DTO mapping and the version rule.
 * No I/O.
 */

/** Map a persisted skill row (plus its agent link count) to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow, agentCount: number): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agent_count: agentCount,
  };
}

/**
 * A new version is created only when the Markdown body actually changes.
 * Metadata edits (name, description, type, enabled, evidence) keep the version.
 */
export function bodyChanged(current: Pick<SkillRow, 'body'>, patch: SkillUpdate): boolean {
  return patch.body !== undefined && patch.body !== current.body;
}

/** The version a skill moves to after `patch` is applied. */
export function nextVersion(current: Pick<SkillRow, 'body' | 'version'>, patch: SkillUpdate): number {
  return bodyChanged(current, patch) ? current.version + 1 : current.version;
}

/** Drizzle `set` values for a patch (only the fields present in it). */
export function toUpdateValues(
  current: Pick<SkillRow, 'body' | 'version'>,
  patch: SkillUpdate,
): Partial<Omit<SkillRow, 'id' | 'workspaceId' | 'createdAt' | 'source'>> {
  return {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.evidence_files !== undefined ? { evidenceFiles: patch.evidence_files } : {}),
    ...(bodyChanged(current, patch) ? { body: patch.body!, version: nextVersion(current, patch) } : {}),
  };
}
