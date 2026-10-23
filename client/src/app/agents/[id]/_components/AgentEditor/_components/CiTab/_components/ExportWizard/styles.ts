import type { CSSProperties } from "react";

/** Export to CI wizard shell (design: Export to CI modal, screenshots 2–5). */
export const s = {
  steps: { padding: "16px 24px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  body: { padding: "20px 24px" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerRight: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
};
