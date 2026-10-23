import type { CSSProperties } from "react";

/** Wizard step 1 — Target (design screenshot 2). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  label: { fontSize: 12.5, fontWeight: 600, marginBottom: 6 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
  locked: { fontSize: 13.5, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  cards: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 } satisfies CSSProperties,
  card: (selected: boolean, available: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: "12px 14px",
    textAlign: "left",
    borderRadius: 8,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent-bg)" : "var(--bg-surface)",
    color: "var(--text-primary)",
    opacity: available ? 1 : 0.55,
    cursor: available ? "pointer" : "not-allowed",
  }),
  cardTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  cardDesc: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  warning: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};
