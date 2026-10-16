import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab (design: Skill Editor · Evals). */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  panel: { border: "1px dashed var(--border)", borderRadius: 9, background: "var(--bg-elevated)" } satisfies CSSProperties,
} as const;
