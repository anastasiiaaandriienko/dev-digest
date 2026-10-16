import type { Skill } from "@devdigest/shared";

/** The skill named by `?preview=`, `null` when the id matches none, `undefined` when no preview is open. */
export function previewedSkill(skills: readonly Skill[] | undefined, id: string | null): Skill | null | undefined {
  if (!id) return undefined;
  if (!skills) return undefined; // still loading: open the drawer once data arrives
  return skills.find((s) => s.id === id) ?? null;
}
