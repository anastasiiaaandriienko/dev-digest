import type { CSSProperties } from "react";

/** Co-located styles for the agent CI tab (design: agent CI tab, screenshot 1). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18, flexWrap: "wrap" } satisfies CSSProperties,
  titleBlock: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 16, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  headActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  addRepo: { marginBottom: 28 } satisfies CSSProperties,
  failOn: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "14px 16px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    maxWidth: 360,
  } satisfies CSSProperties,
  failOnLabel: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
};
