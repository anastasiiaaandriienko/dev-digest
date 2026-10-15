import type { CSSProperties } from "react";

/** Co-located styles for UnsavedChangesModal (mirrors DeleteSkillModal). */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" } satisfies CSSProperties,
  body: { padding: 24, display: "flex", gap: 14, alignItems: "flex-start" } satisfies CSSProperties,
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  text: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 } satisfies CSSProperties,
  lead: { fontSize: 14, color: "var(--text-primary)", margin: 0, wordBreak: "break-word" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-secondary)", margin: 0 } satisfies CSSProperties,
} as const;
