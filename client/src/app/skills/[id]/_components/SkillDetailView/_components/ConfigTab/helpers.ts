import type { Skill, SkillType } from "@devdigest/shared";

export interface ConfigForm {
  name: string;
  description: string;
  type: SkillType;
  enabled: boolean;
  body: string;
}

export type ConfigPatch = Partial<ConfigForm>;

export function formFrom(skill: Skill): ConfigForm {
  return {
    name: skill.name,
    description: skill.description,
    type: skill.type,
    enabled: skill.enabled,
    body: skill.body,
  };
}

/**
 * Only the fields that differ from the saved skill (so a metadata edit never
 * resends — and never re-versions — the body). `name` is compared trimmed, the
 * way the server stores it.
 */
export function changedFields(skill: Skill, form: ConfigForm): ConfigPatch {
  const patch: ConfigPatch = {};
  if (form.name.trim() !== skill.name) patch.name = form.name.trim();
  if (form.description !== skill.description) patch.description = form.description;
  if (form.type !== skill.type) patch.type = form.type;
  if (form.enabled !== skill.enabled) patch.enabled = form.enabled;
  if (form.body !== skill.body) patch.body = form.body;
  return patch;
}

/** Lines and an approximate token count (text length / 4, as in the design). */
export function bodyStats(body: string): { lines: number; tokens: number } {
  return { lines: body === "" ? 0 : body.split("\n").length, tokens: Math.ceil(body.length / 4) };
}
