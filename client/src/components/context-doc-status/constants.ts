import type { IconName } from "@devdigest/ui";
import type { ContextAttachmentStatus } from "@devdigest/shared";

/** Badge look per attachment status. */
export const STATUS_STYLE: Record<ContextAttachmentStatus, { color: string; bg: string; icon: IconName }> = {
  ok: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "Check" },
  missing: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertTriangle" },
  outside_roots: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
};
