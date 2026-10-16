import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab (design: Skill Editor · Preview). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, marginBottom: 4 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 14px" } satisfies CSSProperties,
  card: {
    padding: "18px 22px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 14,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
