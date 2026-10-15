import type { CSSProperties } from "react";
import { FONT_SIZE, GUTTER_WIDTH, LINE_HEIGHT } from "./constants";

// Shared by the highlighted layer and the textarea so wrapped lines match exactly.
const text: CSSProperties = {
  fontSize: FONT_SIZE,
  lineHeight: `${LINE_HEIGHT}px`,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  tabSize: 2,
  letterSpacing: "normal",
};

const lineNo: CSSProperties = {
  ...text,
  whiteSpace: "nowrap",
  width: GUTTER_WIDTH,
  flexShrink: 0,
  textAlign: "right",
  paddingRight: 14,
  color: "var(--text-muted)",
  userSelect: "none",
};

const textarea: CSSProperties = {
  ...text,
  position: "absolute",
  top: 0,
  bottom: 0,
  left: GUTTER_WIDTH,
  right: 0,
  width: `calc(100% - ${GUTTER_WIDTH}px)`,
  height: "100%",
  margin: 0,
  padding: "0 14px 0 0",
  border: "none",
  outline: "none",
  resize: "none",
  overflow: "hidden",
  background: "transparent",
  color: "transparent",
  caretColor: "var(--text-primary)",
};

/** Co-located styles for MarkdownEditor (design: Skill Editor · Config code editor). */
export const s = {
  frame: (focused: boolean, invalid: boolean): CSSProperties => ({
    border: "1px solid " + (invalid ? "var(--crit)" : focused ? "var(--accent)" : "var(--border-strong)"),
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 14px",
    borderBottom: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  filename: {
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  } satisfies CSSProperties,
  tokens: { marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  // The ONLY scroller: the highlighted layer grows with the text and the textarea fills it.
  scroll: (height: number): CSSProperties => ({ height, overflow: "auto", padding: "10px 0" }),
  stage: { position: "relative" } satisfies CSSProperties,
  row: { display: "flex" } satisfies CSSProperties,
  lineNo,
  lineText: (color: string): CSSProperties => ({ ...text, flex: 1, minWidth: 0, color, paddingRight: 14 }),
  textarea,
} as const;
