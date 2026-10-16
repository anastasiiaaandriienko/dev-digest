import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab (design: Agent Editor · Config). */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 14 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  twoCol: { display: "grid", gridTemplateColumns: "minmax(0, 200px) minmax(0, 1fr)", gap: 14 } satisfies CSSProperties,
  tokens: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  inlineToggle: { display: "inline-flex" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
} as const;
