import type { CSSProperties } from "react";

/** Co-located styles for ResultsHeader. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10 },
  topRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-primary)" },
  selected: { fontSize: 13, color: "var(--text-muted)" },
  spacer: { flex: 1 },
  toggle: { display: "inline-flex", gap: 4 },
  infoRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13 },
  pr: { color: "var(--text-secondary)" },
  summary: { color: "var(--text-muted)" },
  partial: { color: "var(--warn)", fontSize: 12 },
} satisfies Record<string, CSSProperties>;
