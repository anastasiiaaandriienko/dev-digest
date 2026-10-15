import type { IconName } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";

/** Constants shared by the /skills route's components (Skills Lab, HW2). */

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
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
};

/** URL search param that holds the previewed skill id (`/skills?preview=<id>`). */
export const PREVIEW_PARAM = "preview";
