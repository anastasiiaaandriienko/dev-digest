import type { CSSProperties } from "react";

/** Co-located styles for RootsPanel. */
export const s = {
  box: { borderTop: "1px solid var(--border)", padding: "8px 12px" } satisfies CSSProperties,
  bar: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 4px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    background: "transparent",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: "2px 8px",
    minWidth: 0,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  root: { overflowWrap: "anywhere" } satisfies CSSProperties,
  editor: { marginTop: 8 } satisfies CSSProperties,
} as const;
