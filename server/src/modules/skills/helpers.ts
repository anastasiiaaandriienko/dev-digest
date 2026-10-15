import type { Skill, SkillImportCandidate, SkillSource, SkillType, SkillUpdate, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

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

/** Map a `skill_versions` row to the public DTO; `current` = the skill's live version. */
export function toSkillVersionDto(row: SkillVersionRow, currentVersion: number): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
    current: row.version === currentVersion,
  };
}

/** Names that occur more than once (case-insensitive), as first written. */
export function duplicateNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const n of names) seen.set(n.toLowerCase(), (seen.get(n.toLowerCase()) ?? 0) + 1);
  const out: string[] = [];
  for (const n of names) {
    if (seen.get(n.toLowerCase())! > 1 && !out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

/**
 * Add a `name` issue to every candidate whose name is already used in the
 * workspace (`taken`) or by another candidate of the same file.
 */
export function markDuplicates(candidates: readonly SkillImportCandidate[], taken: readonly string[]): SkillImportCandidate[] {
  const existing = new Set(taken.map((n) => n.toLowerCase()));
  const twice = new Set(duplicateNames(candidates.map((c) => c.name)).map((n) => n.toLowerCase()));
  return candidates.map((c) => {
    const key = c.name.toLowerCase();
    const extra = [
      ...(existing.has(key) ? [{ field: 'name' as const, message: `A skill named "${c.name}" already exists` }] : []),
      ...(twice.has(key) ? [{ field: 'name' as const, message: `"${c.name}" is used by more than one file` }] : []),
    ];
    return extra.length > 0 ? { ...c, issues: [...c.issues, ...extra] } : c;
  });
}
