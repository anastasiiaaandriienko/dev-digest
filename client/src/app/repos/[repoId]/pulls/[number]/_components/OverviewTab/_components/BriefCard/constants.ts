import type { RiskSeverity } from "@devdigest/shared";

/** Badge colours per risk severity (CSS variables only). */
export const RISK_COLORS: Record<RiskSeverity, { color: string; bg: string }> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** Badge colours for the stale indicator. */
export const STALE_COLORS: { color: string; bg: string } = { color: "var(--warn)", bg: "var(--warn-bg)" };
