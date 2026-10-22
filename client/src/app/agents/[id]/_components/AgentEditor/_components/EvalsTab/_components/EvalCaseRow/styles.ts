import type { CSSProperties } from "react";
import type { EvalCaseKind } from "@devdigest/shared";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 6,
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 12.5, fontWeight: 600 } satisfies CSSProperties,
  kindPill: (kind: EvalCaseKind): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.03em",
    padding: "1px 7px",
    borderRadius: 4,
    textTransform: "uppercase",
    borderStyle: "solid",
    borderWidth: 1,
    color: kind === "must_find" ? "var(--accent-text)" : "var(--text-muted)",
    background: kind === "must_find" ? "var(--accent-bg)" : "var(--bg-hover)",
    borderColor: kind === "must_find" ? "var(--accent)" : "var(--border-strong)",
  }),
  sub: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
} as const;
