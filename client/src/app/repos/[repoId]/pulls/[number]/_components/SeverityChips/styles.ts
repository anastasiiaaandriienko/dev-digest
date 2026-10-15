import type { CSSProperties } from "react";

/** Co-located styles for SeverityChips. */
export const s = {
  row: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  chip: (active: boolean, color: string, bg: string, empty = false): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${active ? color : "var(--border)"}`,
    background: active ? bg : "transparent",
    color: active ? color : "var(--text-secondary)",
    opacity: empty && !active ? 0.6 : 1,
    transition: "all .12s",
  }),
  count: { opacity: 0.85, fontSize: 12 } satisfies CSSProperties,
  readOnly: (color: string, bg: string, empty: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11.5,
    fontWeight: 600,
    color: empty ? "var(--text-muted)" : color,
    background: empty ? "transparent" : bg,
    border: empty ? "1px solid var(--border)" : "1px solid transparent",
  }),
} as const;
