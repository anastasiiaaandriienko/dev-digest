import type { CSSProperties } from "react";

export const s = {
  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "92px 1fr 44px 1.4fr 70px 70px",
    gap: 12,
    padding: "9px 14px",
    alignItems: "center",
    fontSize: 12.5,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  muted: { color: "var(--text-secondary)", fontSize: 11.5 } satisfies CSSProperties,
  version: { color: "var(--accent-text)" } satisfies CSSProperties,
  metrics: { color: "var(--text-secondary)" } satisfies CSSProperties,
  linkCell: { textAlign: "right" } satisfies CSSProperties,
  link: { fontSize: 12, fontWeight: 600, color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
