import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs — exactly Config and Skills (HW2 #35). Evals / Stats / CI come in later lessons. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
];

/** Valid `?tab=` values (anything else falls back to Config). */
export const TAB_KEYS: readonly string[] = TABS.map((tb) => tb.key);
