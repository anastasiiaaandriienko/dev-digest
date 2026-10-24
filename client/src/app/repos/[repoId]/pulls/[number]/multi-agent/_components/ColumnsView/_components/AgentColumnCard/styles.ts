import type { CSSProperties } from "react";

/** Fixed column width: more than 4 columns scroll horizontally instead of shrinking (AC-MAR-58). */
export const COLUMN_WIDTH = 280;

/** Co-located styles for AgentColumnCard. `border` is one shorthand (no borderColor mix). */
export const s = {
  column: (color: string): CSSProperties => ({
    flex: `0 0 ${COLUMN_WIDTH}px`,
    width: COLUMN_WIDTH,
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderTop: `3px solid ${color}`,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    minHeight: 220,
  }),
  head: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border)" },
  headMain: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  meta: { fontSize: 12, color: "var(--text-muted)" },
  body: { flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 6 },
  finding: { display: "flex", gap: 8, padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)" },
  findingMain: { minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  findingTitle: { fontSize: 13, color: "var(--text-primary)" },
  findingLoc: { fontSize: 11, color: "var(--text-muted)" },
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "8px 4px" },
  running: { fontSize: 13, color: "var(--text-muted)", padding: "8px 4px" },
  failed: { display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", borderRadius: 7, border: "1px solid var(--crit)" },
  failedLabel: { fontSize: 12, fontWeight: 700, color: "var(--crit)" },
  failedError: { fontSize: 12, color: "var(--text-secondary)", wordBreak: "break-word" },
  foot: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: "1px solid var(--border)" },
  count: { fontSize: 12, color: "var(--text-muted)" },
} satisfies Record<string, CSSProperties | ((...a: never[]) => CSSProperties)>;
