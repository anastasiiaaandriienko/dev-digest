import type { CSSProperties } from "react";

/** Wizard step 4 — Install (design screenshot 5). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  option: (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    cursor: "pointer",
  }),
  optionText: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  optionTitle: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  optionBody: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  help: { fontSize: 12.5, fontWeight: 600, color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  errorDetail: { color: "var(--text-secondary)", wordBreak: "break-word" } satisfies CSSProperties,
};
