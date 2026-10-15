import type { CSSProperties } from "react";

/** Co-located styles for SkillDetailView (design: Skills Lab, list column + skill editor). */
export const s = {
  // Full height under the 52px top bar; the list and the editor scroll on their own.
  lab: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } satisfies CSSProperties,
  editor: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  state: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, padding: "14px 24px 0", flexWrap: "wrap", flexShrink: 0 } satisfies CSSProperties,
  iconBox: (color: string, bg: string): CSSProperties => ({
    width: 26,
    height: 26,
    borderRadius: 7,
    background: bg,
    color,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  }),
  h1: { fontSize: 16, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  typeChip: (color: string, bg: string): CSSProperties => ({
    fontSize: 10.5,
    fontWeight: 600,
    color,
    background: bg,
    padding: "2px 8px",
    borderRadius: 5,
  }),
  tabs: { marginTop: 12, flexShrink: 0 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 24 } satisfies CSSProperties,
} as const;
