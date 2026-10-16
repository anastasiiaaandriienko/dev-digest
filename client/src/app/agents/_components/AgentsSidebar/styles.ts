import type { CSSProperties } from "react";

/** Co-located styles for AgentsSidebar (design: Agents list column, 280px). */
export const s = {
  column: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
    minHeight: 0,
  } satisfies CSSProperties,
  head: { padding: "14px 14px 10px", flexShrink: 0 } satisfies CSSProperties,
  // Without agents the heading stands alone (design: Agents · empty state).
  titleRow: (alone: boolean): CSSProperties => ({ display: "flex", alignItems: "center", gap: 8, marginBottom: alone ? 0 : 12 }),
  h2: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    cursor: "text",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  scroll: { flex: 1, minHeight: 0, overflow: "auto", padding: "0 10px 10px" } satisfies CSSProperties,
  stack: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
