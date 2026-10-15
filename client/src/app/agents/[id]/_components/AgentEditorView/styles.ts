import type { CSSProperties } from "react";

/** Co-located styles for the Agent Editor page (design: Agents list column + editor). */
export const s = {
  // Full height under the 52px top bar; the list and the editor scroll on their own.
  lab: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } satisfies CSSProperties,
  editor: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" } satisfies CSSProperties,
  state: { padding: 24, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, padding: "14px 24px 0", flexWrap: "wrap", flexShrink: 0 } satisfies CSSProperties,
  headerIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  h1: { fontSize: 17, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" } satisfies CSSProperties,
  headerActions: { marginLeft: "auto" } satisfies CSSProperties,
} as const;
