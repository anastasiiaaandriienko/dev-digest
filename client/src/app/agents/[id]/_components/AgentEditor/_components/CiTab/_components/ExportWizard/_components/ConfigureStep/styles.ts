import type { CSSProperties } from "react";

/** Wizard step 3 — Configure (design screenshot 4). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  label: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  chips: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  chip: (on: boolean): CSSProperties => ({
    padding: "5px 12px",
    borderRadius: 99,
    border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
    background: on ? "var(--accent-bg)" : "transparent",
    color: on ? "var(--accent-text)" : "var(--text-secondary)",
    fontSize: 12.5,
    fontFamily: "var(--font-mono)",
    cursor: "pointer",
  }),
  secretRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  radio: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" } satisfies CSSProperties,
  info: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  confirm: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  confirmActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
};
