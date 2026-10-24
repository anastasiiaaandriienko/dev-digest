import type { CSSProperties } from "react";

/** Co-located styles for ColumnsView: a horizontal strip of fixed-width columns. */
export const s = {
  strip: { display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, alignItems: "stretch" },
} satisfies Record<string, CSSProperties>;
