import type { CSSProperties } from "react";

/** Co-located styles for TabsView. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 },
  agentHead: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  },
  agentMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 },
  agentName: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" },
  summary: { fontSize: 13, color: "var(--text-secondary)" },
  meta: { fontSize: 12, color: "var(--text-muted)", textAlign: "right", display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" },
  status: { fontSize: 13, color: "var(--text-muted)" },
  failed: { fontSize: 13, color: "var(--crit)" },
  findings: { display: "flex", flexDirection: "column", gap: 10 },
  empty: { fontSize: 13, color: "var(--text-muted)" },
} satisfies Record<string, CSSProperties>;
