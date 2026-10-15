import type { Skill } from "@devdigest/shared";

/** Case-insensitive match on name or description; a blank query keeps all. */
export function filterSkills(skills: readonly Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
}

/** The skill named by `?preview=`, `null` when the id matches none, `undefined` when no preview is open. */
export function previewedSkill(skills: readonly Skill[] | undefined, id: string | null): Skill | null | undefined {
  if (!id) return undefined;
  if (!skills) return undefined; // still loading: open the drawer once data arrives
  return skills.find((s) => s.id === id) ?? null;
}
