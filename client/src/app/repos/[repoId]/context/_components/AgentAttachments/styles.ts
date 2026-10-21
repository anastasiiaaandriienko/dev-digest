import type { CSSProperties } from "react";

/** Co-located styles for AgentAttachments. */
export const s = {
  box: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    marginTop: 20,
  } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
