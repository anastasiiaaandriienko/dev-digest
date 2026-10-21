import type { ContextAttachmentStatus } from "@devdigest/shared";

/** Root badge colours by the root's last path segment (Q23 A11); any other root is neutral. */
export const ROOT_STYLE: Readonly<Record<string, { color: string; bg: string }>> = {
  specs: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  docs: { color: "var(--info)", bg: "var(--info-bg)" },
  insights: { color: "var(--ok)", bg: "var(--ok-bg)" },
};

/** Neutral badge for roots without a fixed colour. */
export const ROOT_NEUTRAL = { color: "var(--text-secondary)", bg: "var(--bg-hover)" } as const;

/** Statuses that get a badge on the row ("ok" is implied by the checked box). */
export const BADGED_STATUSES: readonly ContextAttachmentStatus[] = ["missing", "outside_roots"];
