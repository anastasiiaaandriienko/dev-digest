import type { CSSProperties } from "react";

/** CI Runs page (design artboards `CI Runs (N13)` / `CI Runs · empty`). */
export const s = {
  page: { padding: "24px 28px", maxWidth: 1280 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18, flexWrap: "wrap" } satisfies CSSProperties,
  titleBlock: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  headActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  filters: { display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 14, flexWrap: "wrap" } satisfies CSSProperties,
  filter: { display: "flex", flexDirection: "column", gap: 4, minWidth: 220 } satisfies CSSProperties,
  filterLabel: { fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)" } satisfies CSSProperties,
};
