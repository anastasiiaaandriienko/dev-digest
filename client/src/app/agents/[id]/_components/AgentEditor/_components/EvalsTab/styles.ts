import type { CSSProperties } from "react";

/** Co-located styles for the Evals tab (design screen_agents.jsx `EvalsTab`). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  sectionHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  sectionRight: { marginLeft: "auto" } satisfies CSSProperties,
  dashboardLink: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  metricsFrom: { fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 } satisfies CSSProperties,
  scoringNote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
  } satisfies CSSProperties,
  banner: (tone: "info" | "warn"): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: tone === "warn" ? "var(--warn)" : "var(--border-strong)",
    background: tone === "warn" ? "var(--warn-bg)" : "var(--bg-elevated)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginBottom: 16,
  }),
  casesHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" } satisfies CSSProperties,
  casesTitle: { fontSize: 16, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  casesActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  historyWrap: { marginTop: 28 } satisfies CSSProperties,
} as const;
