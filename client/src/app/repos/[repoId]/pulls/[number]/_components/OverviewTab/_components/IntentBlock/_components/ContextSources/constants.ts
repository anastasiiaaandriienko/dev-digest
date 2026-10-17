import type { IntentContextStatus } from "@devdigest/shared";

/** Badge colours per context status (CSS variables only). */
export const STATUS_COLORS: Record<IntentContextStatus, { color: string; bg: string }> = {
  confirmed: { color: "var(--ok)", bg: "var(--ok-bg)" },
  unverified: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  unavailable: { color: "var(--warn)", bg: "var(--warn-bg)" },
  missing: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
};
