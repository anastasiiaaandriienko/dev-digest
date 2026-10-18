import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 1100 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  controls: { display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  controlCell: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
    gap: 14,
    alignItems: "start",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  name: { fontSize: 13, color: "var(--text-primary)", overflowWrap: "anywhere" } satisfies CSSProperties,
  folder: { fontSize: 11.5, color: "var(--text-muted)", overflowWrap: "anywhere" } satisfies CSSProperties,
  size: { fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  stateText: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
