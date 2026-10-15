import type { CSSProperties } from "react";

/** Co-located styles for ImportCandidate. */
export const s = {
  card: (include: boolean, invalid: boolean): CSSProperties => ({
    border: `1px solid ${include && invalid ? "var(--crit)" : "var(--border)"}`,
    borderRadius: 10,
    background: include ? "var(--bg-primary)" : "transparent",
    opacity: include ? 1 : 0.65,
    padding: "12px 16px 0",
  }),
  head: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 } satisfies CSSProperties,
  path: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  status: (include: boolean, invalid: boolean): CSSProperties => ({
    fontSize: 11.5,
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: 999,
    color: !include ? "var(--text-muted)" : invalid ? "var(--crit)" : "var(--ok)",
    background: !include ? "var(--bg-hover)" : invalid ? "var(--crit-bg)" : "var(--ok-bg)",
  }),
  fields: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  typeCol: { width: 170, flexShrink: 0 } satisfies CSSProperties,
  editor: { marginTop: 10 } satisfies CSSProperties,
  rendered: {
    maxHeight: 260,
    overflow: "auto",
    padding: "10px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
} as const;
