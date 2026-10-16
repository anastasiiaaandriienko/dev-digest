import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab (design: Skill Editor · Config). */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  enabled: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  stats: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" } satisfies CSSProperties,
  saveNote: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  saveNoteVersion: { color: "var(--text-secondary)" } satisfies CSSProperties,
  muted: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
  danger: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  dangerTitle: { fontSize: 13, fontWeight: 600, color: "var(--crit)", marginBottom: 2 } satisfies CSSProperties,
} as const;
