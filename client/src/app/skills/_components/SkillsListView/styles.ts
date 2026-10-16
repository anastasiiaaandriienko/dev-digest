import type { CSSProperties } from "react";

/** Co-located styles for SkillsListView (design: Skills Lab, list column + editor area). */
export const s = {
  // Full height under the 52px top bar; the list and the editor scroll on their own.
  lab: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } satisfies CSSProperties,
  editor: { flex: 1, minWidth: 0, display: "grid", placeItems: "center", padding: 24 } satisfies CSSProperties,
} as const;
