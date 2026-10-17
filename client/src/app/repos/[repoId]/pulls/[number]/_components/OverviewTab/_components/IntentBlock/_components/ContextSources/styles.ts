import type { CSSProperties } from "react";

export const s = {
  groupTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  root: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  kind: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  ref: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    color: "var(--text-primary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  gaps: { margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 } satisfies CSSProperties,
} as const;
