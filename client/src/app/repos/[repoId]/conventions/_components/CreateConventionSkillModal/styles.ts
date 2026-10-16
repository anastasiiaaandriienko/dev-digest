import type { CSSProperties } from "react";
import { BODY_EDITOR_HEIGHT } from "./constants";

/** Co-located styles for CreateConventionSkillModal (design: N7 CreateSkillModal). */
export const s = {
  body: { padding: "18px 22px 8px", display: "flex", flexDirection: "column" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  savedAs: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginRight: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  info: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 13px",
    borderRadius: 8,
    background: "var(--accent-bg)",
    border: "1px solid var(--border)",
    marginBottom: 18,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  infoIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  infoStrong: { color: "var(--text-primary)" } satisfies CSSProperties,
  infoRepo: { color: "var(--accent-text)" } satisfies CSSProperties,
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  toggle: { display: "flex", alignItems: "center", height: 36 } satisfies CSSProperties,
  // Same height as the editor, so Edit ↔ Preview does not jump.
  preview: {
    height: BODY_EDITOR_HEIGHT,
    overflow: "auto",
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
    fontSize: 14,
  } satisfies CSSProperties,
  loading: { display: "flex", flexDirection: "column", gap: 10, paddingBottom: 14 } satisfies CSSProperties,
  loadError: {
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 14,
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  error: { color: "var(--crit)" } satisfies CSSProperties,
} as const;
