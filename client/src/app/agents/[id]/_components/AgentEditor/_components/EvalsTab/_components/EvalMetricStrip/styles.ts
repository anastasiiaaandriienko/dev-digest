import type { CSSProperties } from "react";

export const s = {
  strip: { display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap" } satisfies CSSProperties,
  tile: {
    flex: "1 1 140px",
    padding: "11px 13px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 6,
  } satisfies CSSProperties,
  valueRow: { display: "flex", alignItems: "baseline", gap: 7 } satisfies CSSProperties,
  value: (color: string): CSSProperties => ({ fontSize: 22, fontWeight: 700, color }),
  delta: (d: number): CSSProperties => ({ fontSize: 11.5, fontWeight: 600, color: d >= 0 ? "var(--ok)" : "var(--crit)" }),
  fp: { fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 } satisfies CSSProperties,
} as const;
