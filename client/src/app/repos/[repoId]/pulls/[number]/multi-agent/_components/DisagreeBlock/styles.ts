import type { CSSProperties } from "react";

/** Co-located styles for DisagreeBlock. Borders are full shorthands (no borderColor mix). */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  heading: { fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", margin: 0 },
  toggle: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" },
  partial: { fontSize: 12, color: "var(--warn)" },
  none: { fontSize: 13, color: "var(--text-muted)", padding: "8px 2px" },
  row: { border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-elevated)", overflow: "hidden" },
  rowHead: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" },
  location: { fontSize: 12, color: "var(--text-secondary)" },
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" },
  cells: { display: "flex", overflowX: "auto" },
  cell: { flex: "1 0 180px", minWidth: 180, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 4, borderRight: "1px solid var(--border)" },
  persona: { fontSize: 12, color: "var(--text-muted)" },
  verdictRow: { display: "flex", alignItems: "center", gap: 6 },
  note: { fontSize: 12, color: "var(--text-secondary)" },
  ignored: { fontSize: 12, color: "var(--text-muted)" },
  noResult: { fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", opacity: 0.7 },
} satisfies Record<string, CSSProperties>;
