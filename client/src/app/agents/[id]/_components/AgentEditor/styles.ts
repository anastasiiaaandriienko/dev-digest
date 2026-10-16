import type { CSSProperties } from "react";

/** Co-located styles for the AgentEditor shell (design: Agent Editor tabs + scrolling body). */
export const s = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  tabsBar: { marginTop: 12, flexShrink: 0 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 24 } satisfies CSSProperties,
} as const;
