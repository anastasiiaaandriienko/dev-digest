import type { CSSProperties } from "react";

export const s = {
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  stats: {
    marginTop: -6,
    marginBottom: 12,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  outside: { marginTop: 14 } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
} as const;
