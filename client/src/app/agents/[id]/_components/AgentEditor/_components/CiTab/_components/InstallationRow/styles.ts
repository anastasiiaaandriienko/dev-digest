import type { CSSProperties } from "react";

/** One CI installation of the agent (design: agent CI tab rows). */
export const s = {
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  top: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  repo: { fontSize: 13.5, fontWeight: 600, fontFamily: "var(--font-mono)" } satisfies CSSProperties,
  target: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" } satisfies CSSProperties,
  meta: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  outdated: { color: "var(--warn)" } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  link: { fontSize: 12.5, fontWeight: 600, color: "var(--accent-text)", textDecoration: "none" } satisfies CSSProperties,
};
