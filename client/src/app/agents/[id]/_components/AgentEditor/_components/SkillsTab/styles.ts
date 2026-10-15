import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab (design: Agent Editor · Skills). */
export const s = {
  wrap: { maxWidth: 680, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  search: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
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
  hint: { fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 8px" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0 } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
} as const;
