import type { CSSProperties } from "react";

/** Columns in AC-CI-51 order, then when it ran and the job link. */
const COLUMNS = "minmax(140px, 1.4fr) 56px minmax(120px, 1fr) 88px 72px 80px 76px 76px 72px 84px";

export const s = {
  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "auto",
    background: "var(--bg-elevated)",
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
    minWidth: 960,
  } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: 12,
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    alignItems: "center",
    fontSize: 12.5,
    minWidth: 960,
  } satisfies CSSProperties,
  mono: { fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  link: { fontWeight: 600, color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
};
