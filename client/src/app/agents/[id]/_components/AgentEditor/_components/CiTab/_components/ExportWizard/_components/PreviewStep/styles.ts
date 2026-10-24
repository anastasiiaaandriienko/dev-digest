import type { CSSProperties } from "react";

/** Wizard step 2 — Preview (design screenshot 3): file list on the left, contents on the right. */
export const s = {
  wrap: { display: "grid", gridTemplateColumns: "240px minmax(0, 1fr)", gap: 16, minHeight: 320 } satisfies CSSProperties,
  listTitle: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  file: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 8px",
    borderRadius: 6,
    border: "none",
    textAlign: "left",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    background: selected ? "var(--bg-hover)" : "transparent",
    cursor: "pointer",
    wordBreak: "break-all",
  }),
  pane: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } satisfies CSSProperties,
  paneHead: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  code: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 360,
    overflow: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  note: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  limit: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
};
