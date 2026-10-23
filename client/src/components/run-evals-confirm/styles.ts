import type { CSSProperties } from "react";

export const s = {
  body: { padding: "16px 18px" } satisfies CSSProperties,
  text: { fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" } satisfies CSSProperties,
  paid: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  paidIcon: { color: "var(--warn)", flexShrink: 0 } satisfies CSSProperties,
  error: {
    marginTop: 12,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  footer: { display: "flex", gap: 8, marginLeft: "auto" } satisfies CSSProperties,
} as const;
