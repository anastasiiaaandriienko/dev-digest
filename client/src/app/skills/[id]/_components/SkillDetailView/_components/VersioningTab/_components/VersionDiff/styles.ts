import type { CSSProperties } from "react";

/** Co-located styles for VersionDiff (rows themselves are styled by CodeLine). */
export const s = {
  wrap: {
    marginTop: 10,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  title: { fontSize: 12.5, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  stats: { fontSize: 12, fontWeight: 600 } satisfies CSSProperties,
  added: { color: "var(--code-add-text)" } satisfies CSSProperties,
  removed: { color: "var(--code-del-text)" } satisfies CSSProperties,
  lines: { maxHeight: 420, overflow: "auto", padding: "6px 0" } satisfies CSSProperties,
  identical: { padding: "14px 16px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
