import type { CSSProperties } from "react";

/** Co-located styles for ContextDocAttachments. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  picker: { display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  pickerSelect: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  path: { flex: 1, fontSize: 12.5, overflowWrap: "anywhere", color: "var(--text-primary)" } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
