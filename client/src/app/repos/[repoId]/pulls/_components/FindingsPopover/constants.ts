/** Constants for the PR-list findings popover (L01, client spec §4). */

/** Hover delay before the popover opens (ms), so passing the mouse over rows doesn't fetch. */
export const HOVER_OPEN_DELAY_MS = 250;

/** Grace period before closing, so the pointer can travel from the icon into the popover (ms). */
export const HOVER_CLOSE_DELAY_MS = 150;

/** Number of findings listed in the popover. */
export const TOP_FINDINGS = 3;

/** Popover width (px); also used to keep it inside the viewport. */
export const POPOVER_WIDTH = 340;
