import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab (design: agent editor · Skills). */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  h3: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginTop: 10,
  } satisfies CSSProperties,
  search: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 220,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 12.5,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  hint: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6, margin: 0, padding: 0 } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
} as const;
