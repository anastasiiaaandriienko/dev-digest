import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs — exactly Config, Skills and Context (HW2 #35 as amended by CTX A1). Evals / Stats / CI come in later lessons. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
];

/** Valid `?tab=` values (anything else falls back to Config). */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);
