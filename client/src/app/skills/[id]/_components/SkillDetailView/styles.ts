import type { CSSProperties } from "react";

/** Co-located styles for SkillDetailView (design: Skill Editor header + tabs). */
export const s = {
  page: { padding: "20px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  back: { fontSize: 12.5, color: "var(--text-muted)", textDecoration: "none" } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 16, marginTop: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" } satisfies CSSProperties,
  iconBox: (color: string, bg: string): CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 7,
    background: bg,
    color,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  }),
  h1: { fontSize: 18, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  typeChip: (color: string, bg: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color,
    background: bg,
    padding: "2px 8px",
    borderRadius: 5,
  }),
  tabs: { marginTop: 14, borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  body: { paddingTop: 22 } satisfies CSSProperties,
} as const;
