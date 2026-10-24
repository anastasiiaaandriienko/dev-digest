import type { CSSProperties } from "react";

/** Co-located styles for AgentPickCard. `border` is always set as one shorthand
   (never mixed with borderColor) to avoid React's shorthand/longhand warning. */
export const s = {
  card: (color: string, checked: boolean, blocked: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 9,
    border: `1px solid ${checked ? color : "var(--border)"}`,
    background: checked ? "var(--bg-elevated)" : "transparent",
    opacity: blocked ? 0.5 : 1,
  }),
  icon: (color: string): CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    color,
    border: `1px solid ${color}`,
  }),
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 },
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" },
  description: { fontSize: 12, color: "var(--text-muted)" },
  estimate: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 },
} satisfies Record<string, CSSProperties | ((...a: never[]) => CSSProperties)>;
