import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  filterStatus: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "-6px 0 12px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  clearLink: {
    background: "none",
    border: "none",
    padding: 0,
    font: "inherit",
    color: "var(--accent-text)",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: 3,
  } satisfies CSSProperties,
} as const;
