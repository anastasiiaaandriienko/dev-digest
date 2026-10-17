import type { CSSProperties } from "react";

export const s = {
  wrap: { position: "relative", display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  agent: {
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  hide: {
    position: "absolute",
    top: 4,
    right: 40,
    zIndex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } satisfies CSSProperties,
} as const;
