/* lib/skill-meta.ts — how a skill's type and source are shown, shared by the
   Skills Lab pages (/skills) and the agent editor's Skills tab. No JSX. */
import type { IconName } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";

/** Skill types in display order (matches the `SkillType` contract). */
export const SKILL_TYPES: SkillType[] = ["rubric", "convention", "security", "custom"];

/** Type → colour tokens (design: rubric blue, convention green, security red, custom grey). */
export const TYPE_COLOR: Record<SkillType, { c: string; bg: string }> = {
  rubric: { c: "var(--accent)", bg: "var(--accent-bg)" },
  convention: { c: "var(--ok)", bg: "var(--ok-bg)" },
  security: { c: "var(--crit)", bg: "var(--crit-bg)" },
  custom: { c: "var(--text-muted)", bg: "var(--bg-hover)" },
};

/** Source → icon (labels come from `skills.listItem.source`). */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  imported: "Upload",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
};

/** Sources whose content came from outside the workspace and must be reviewed. */
export const UNTRUSTED_SOURCES: readonly SkillSource[] = ["imported", "imported_url", "community"];

/** An untrusted skill nobody has enabled yet: show "needs vetting". */
export function needsVetting(skill: Pick<Skill, "source" | "enabled">): boolean {
  return !skill.enabled && UNTRUSTED_SOURCES.includes(skill.source);
}
