import type { CSSProperties } from "react";
import type { EvalCaseKind } from "@devdigest/shared";

/** Co-located styles for AddToEvalModal (design `EvalCaseEditor`, seeded variant). */
export const s = {
  body: { padding: "16px 18px", maxHeight: 560, overflow: "auto" } satisfies CSSProperties,
  banner: (kind: EvalCaseKind): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "9px 12px",
    marginBottom: 18,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: kind === "must_find" ? "var(--accent)" : "var(--border-strong)",
    background: kind === "must_find" ? "var(--accent-bg)" : "var(--bg-elevated)",
  }),
  bannerIcon: (kind: EvalCaseKind): CSSProperties => ({
    color: kind === "must_find" ? "var(--accent)" : "var(--text-muted)",
    flexShrink: 0,
  }),
  bannerText: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  bannerKind: (kind: EvalCaseKind): CSSProperties => ({
    color: kind === "must_find" ? "var(--accent-text)" : "var(--text-primary)",
    textTransform: "uppercase",
    fontSize: 10.5,
    letterSpacing: "0.05em",
    marginRight: 7,
    fontWeight: 700,
  }),
  fieldError: { fontSize: 12, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,
  expectedLabel: { fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 7 } satisfies CSSProperties,
  expected: {
    margin: 0,
    padding: 12,
    fontSize: 11.5,
    lineHeight: 1.55,
    background: "var(--code-bg)",
    borderRadius: 7,
    color: "var(--text-primary)",
    overflow: "auto",
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  frozenNote: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 12 } satisfies CSSProperties,
  apiError: {
    marginTop: 14,
    padding: "9px 12px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    color: "var(--text-primary)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  footer: { display: "flex", gap: 8, marginLeft: "auto" } satisfies CSSProperties,
} as const;
