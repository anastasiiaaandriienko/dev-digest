import type { CSSProperties } from "react";

/** Co-located styles for StatCard (design: Skill Editor · Stats metric tile). */
export const s = {
  card: {
    flex: "1 1 160px",
    minWidth: 0,
    padding: 15,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  valueRow: { marginTop: 10, display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  value: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  suffix: { fontSize: 15, color: "var(--text-muted)" } satisfies CSSProperties,
  dash: { fontSize: 26, fontWeight: 700, color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
