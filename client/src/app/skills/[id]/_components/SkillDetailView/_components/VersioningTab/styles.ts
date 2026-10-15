import type { CSSProperties } from "react";

/** Co-located styles for VersioningTab (design: Skill Editor · Versions). */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 16px" } satisfies CSSProperties,
  blocked: {
    fontSize: 12.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 12px",
    borderRadius: 7,
    margin: "0 0 14px",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" } satisfies CSSProperties,
  item: (current: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    background: "var(--bg-elevated)",
  }),
  row: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  chip: (current: boolean): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 700,
    color: current ? "var(--accent-text)" : "var(--text-secondary)",
    background: current ? "var(--accent-bg)" : "var(--bg-hover)",
    padding: "3px 9px",
    borderRadius: 6,
    flexShrink: 0,
  }),
  meta: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 500, color: "var(--text-primary)" } satisfies CSSProperties,
  when: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", gap: 6 } satisfies CSSProperties,
} as const;
