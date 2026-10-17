import type { SmartGroupKey } from "@/lib/smart-diff";

/** Group -> colour of the small square next to its label. */
export const GROUP_COLOR: Record<SmartGroupKey, string> = {
  core: "var(--accent)",
  tests: "var(--ok)",
  wiring: "var(--warn)",
  docs: "var(--info)",
  boilerplate: "var(--text-muted)",
};

/** Group -> i18n keys (namespace prReview). */
export const GROUP_LABEL_KEY = {
  core: "smartDiff.coreLabel",
  tests: "smartDiff.testsLabel",
  wiring: "smartDiff.wiringLabel",
  docs: "smartDiff.docsLabel",
  boilerplate: "smartDiff.boilerplateLabel",
} as const satisfies Record<SmartGroupKey, string>;

export const GROUP_HINT_KEY = {
  core: "smartDiff.coreHint",
  tests: "smartDiff.testsHint",
  wiring: "smartDiff.wiringHint",
  docs: "smartDiff.docsHint",
  boilerplate: "smartDiff.boilerplateHint",
} as const satisfies Record<SmartGroupKey, string>;
