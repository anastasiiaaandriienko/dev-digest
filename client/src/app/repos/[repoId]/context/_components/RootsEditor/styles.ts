import type { CSSProperties } from "react";

/** Co-located styles for RootsEditor. */
export const s = {
  box: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    marginBottom: 16,
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "baseline", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
} as const;
