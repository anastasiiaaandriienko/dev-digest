import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  typeCol: { width: 180, flexShrink: 0 } satisfies CSSProperties,
  editor: { marginTop: 10 } satisfies CSSProperties,
  preview: {
    minHeight: 220,
    maxHeight: 320,
    overflow: "auto",
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 14,
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
} as const;
