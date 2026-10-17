import type { IntentFreshness } from "@devdigest/shared";

/** Badge colours per freshness (CSS variables only). */
export const FRESHNESS_COLORS: Record<IntentFreshness, { color: string; bg: string }> = {
  fresh: { color: "var(--ok)", bg: "var(--ok-bg)" },
  stale: { color: "var(--warn)", bg: "var(--warn-bg)" },
  unknown: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** Number of leading characters of a head sha shown in the meta line. */
export const SHORT_SHA_LENGTH = 7;
