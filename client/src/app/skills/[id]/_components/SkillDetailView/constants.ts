import type { IconName } from "@devdigest/ui";

/** Skill page tab (`?tab=`); the label resolves under `skills.detail.tabs`. */
export interface SkillTab {
  key: "config" | "preview" | "versioning";
  icon: IconName;
}

/** HW2 #25: exactly Config, Preview and Versioning (Stats arrives in a later lesson). */
export const TABS: readonly SkillTab[] = [
  { key: "config", icon: "Settings" },
  { key: "preview", icon: "Eye" },
  { key: "versioning", icon: "History" },
];

export const DEFAULT_TAB: SkillTab["key"] = "config";
