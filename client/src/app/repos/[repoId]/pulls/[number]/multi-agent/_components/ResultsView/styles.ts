import type { CSSProperties } from "react";

/** Co-located styles for ResultsView. */
export const s = {
  page: { padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1240, margin: "0 auto" },
  loading: { padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1240, margin: "0 auto" },
} satisfies Record<string, CSSProperties>;
