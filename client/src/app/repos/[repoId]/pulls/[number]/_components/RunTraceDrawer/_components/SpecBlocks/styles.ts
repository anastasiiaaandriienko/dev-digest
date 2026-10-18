import type { CSSProperties } from "react";

/** Co-located styles for SpecBlocks (trace drawer · prompt assembly). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 } satisfies CSSProperties,
  title: { fontWeight: 700, color: "var(--accent-text)" } satisfies CSSProperties,
  meta: { color: "var(--text-secondary)" } satisfies CSSProperties,
  tokens: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    margin: 0,
    padding: "6px 10px",
    listStyle: "none",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  item: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, flexWrap: "wrap" } satisfies CSSProperties,
  path: { fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  source: { color: "var(--text-secondary)" } satisfies CSSProperties,
  status: (color: string): CSSProperties => ({ color, fontWeight: 600 }),
  reason: { color: "var(--text-muted)" } satisfies CSSProperties,
  truncated: { color: "var(--warn)" } satisfies CSSProperties,
  blockTokens: { color: "var(--text-muted)", fontSize: 11 } satisfies CSSProperties,
  limits: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
