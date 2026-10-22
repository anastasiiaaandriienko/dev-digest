import type { CSSProperties } from "react";

/** Co-located styles for SerializesAs. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  label: {
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "10px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: 12.5,
  } satisfies CSSProperties,
  h2: { color: "var(--text-primary)", fontWeight: 700 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  h3: { color: "var(--accent-text)", fontWeight: 600 } satisfies CSSProperties,
  docs: { listStyle: "none", margin: 0, padding: "0 0 0 14px", display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  doc: { display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 } satisfies CSSProperties,
  path: { color: "var(--text-secondary)", overflowWrap: "anywhere" } satisfies CSSProperties,
  tokens: { marginLeft: "auto", color: "var(--text-muted)", whiteSpace: "nowrap" } satisfies CSSProperties,
  muted: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
} as const;
