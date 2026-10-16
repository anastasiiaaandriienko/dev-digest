/** Skill editor tab (`?tab=`); the label resolves under `skills.detail.tabs`. */
export interface SkillTab {
  key: "config" | "preview" | "evals" | "stats" | "versioning";
}

/** Design: Config | Preview | Evals | Stats | Versions (`versioning` keeps old links working). */
export const TABS: readonly SkillTab[] = [
  { key: "config" },
  { key: "preview" },
  { key: "evals" },
  { key: "stats" },
  { key: "versioning" },
];

export const DEFAULT_TAB: SkillTab["key"] = "config";
