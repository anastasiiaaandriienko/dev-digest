import type { CSSProperties } from "react";

const COLUMNS = "34px 150px 52px 1fr 1fr 1fr 64px 72px 80px";

export const s = {
  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    marginTop: 8,
  } satisfies CSSProperties,
  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: 12,
    padding: "9px 16px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  row: (on: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: 12,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    alignItems: "center",
    fontSize: 12.5,
    cursor: "pointer",
    background: on ? "var(--bg-hover)" : "transparent",
  }),
  muted: { color: "var(--text-secondary)", fontSize: 11.5 } satisfies CSSProperties,
  version: { color: "var(--accent-text)" } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
