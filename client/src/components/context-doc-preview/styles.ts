import type { CSSProperties } from "react";

/** Co-located styles for DocPreview. */
export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    minHeight: 200,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  path: { fontSize: 12.5, color: "var(--text-primary)", overflowWrap: "anywhere", flex: 1 } satisfies CSSProperties,
  body: { padding: "12px 16px", fontSize: 13.5, overflow: "auto", maxHeight: 520 } satisfies CSSProperties,
  bodyFill: { padding: "12px 16px", fontSize: 13.5, overflow: "auto" } satisfies CSSProperties,
  note: { padding: "8px 16px", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  state: { padding: 16, fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { padding: 16, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
