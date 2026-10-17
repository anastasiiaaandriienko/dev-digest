/** Short form of the indexed commit SHA shown next to the block title. */
export const SHORT_SHA_LENGTH = 7;

/** Symbol kinds rendered with a call suffix, e.g. `rateLimit()`. */
export const CALLABLE_KINDS: ReadonlySet<string> = new Set(["function", "method"]);

export const ENDPOINT_COLORS = { color: "var(--info)", bg: "var(--info-bg)" } as const;
export const CRON_COLORS = { color: "var(--warn)", bg: "var(--warn-bg)" } as const;
