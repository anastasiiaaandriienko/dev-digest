import type { CSSProperties } from "react";

const TONES = {
  accent: { border: "var(--accent)", bg: "var(--accent-bg)", icon: "var(--accent)" },
  crit: { border: "var(--crit)", bg: "var(--crit-bg)", icon: "var(--crit)" },
} as const;

/** Co-located styles for ConventionsView (design: N7 ScreenConventions). */
export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 } satisfies CSSProperties,
  grow: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  title: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repo: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  banner: (tone: keyof typeof TONES): CSSProperties => ({
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${TONES[tone].border}`,
    background: TONES[tone].bg,
    marginBottom: 16,
    fontSize: 13,
  }),
  bannerIcon: { color: "var(--crit)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  spin: { color: "var(--accent)", flexShrink: 0, marginTop: 2, animation: "ddspin 1s linear infinite" } satisfies CSSProperties,
  bannerTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { color: "var(--text-secondary)", marginTop: 2, overflowWrap: "anywhere" } satisfies CSSProperties,
  bannerHint: { color: "var(--text-muted)", marginTop: 4, fontSize: 12 } satisfies CSSProperties,
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 } satisfies CSSProperties,
  toolbarEnd: { marginLeft: "auto" } satisfies CSSProperties,
  count: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  hidden: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12, listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
} as const;
