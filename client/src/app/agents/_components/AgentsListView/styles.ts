import type { CSSProperties } from "react";

/** Co-located styles for AgentsListView (design: Agents list column + editor area, empty state). */
export const s = {
  // Full height under the 52px top bar; the list and the editor scroll on their own.
  lab: { display: "flex", height: "calc(100vh - 52px)", minHeight: 0 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0, display: "grid", placeItems: "center", padding: 40 } satisfies CSSProperties,
  empty: { textAlign: "center", maxWidth: 380 } satisfies CSSProperties,
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    margin: "0 auto 18px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    display: "grid",
    placeItems: "center",
    color: "var(--accent)",
  } satisfies CSSProperties,
  emptyTitle: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  emptyBody: { fontSize: 13.5, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.55 } satisfies CSSProperties,
  emptyActions: { display: "flex", gap: 8, justifyContent: "center", marginTop: 18 } satisfies CSSProperties,
} as const;
