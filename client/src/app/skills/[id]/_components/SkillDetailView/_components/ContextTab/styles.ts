import type { CSSProperties } from "react";

/** Co-located styles for ContextTab. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
