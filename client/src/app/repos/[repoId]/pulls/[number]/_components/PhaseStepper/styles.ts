import type { CSSProperties } from "react";
import type { PhaseState } from "@/lib/run-phases";

const COLOR: Record<PhaseState, string> = {
  pending: "var(--text-muted)",
  active: "var(--accent)",
  completed: "var(--ok)",
  skipped: "var(--text-muted)",
  failed: "var(--crit)",
};

/** Co-located styles for PhaseStepper. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 } satisfies CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  list: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  item: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  icon: (state: PhaseState): CSSProperties => ({
    color: COLOR[state],
    flexShrink: 0,
    ...(state === "active" ? { animation: "ddspin 1s linear infinite" } : {}),
  }),
  name: (state: PhaseState): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: state === "active" || state === "failed" ? 600 : 500,
    color: state === "pending" || state === "skipped" ? "var(--text-muted)" : "var(--text-primary)",
  }),
  stateTag: (state: PhaseState): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: COLOR[state],
  }),
  progress: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  sep: { width: 18, height: 1, background: "var(--border)", margin: "0 2px" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
