import type { LineKind } from "./helpers";

/** Editor text metrics: the textarea and the highlighted layer must share them exactly. */
export const FONT_SIZE = 12.5;
export const LINE_HEIGHT = 21;
/** Width of the line-number gutter. */
export const GUTTER_WIDTH = 46;
/** Visible height of the editing area (it scrolls past that). */
export const EDITOR_HEIGHT = 460;

/** Line colours (colour only, never weight: a bolder glyph could shift the caret). */
export const KIND_COLOR: Record<LineKind, string> = {
  heading: "var(--accent-text)",
  list: "var(--text-secondary)",
  fence: "var(--text-muted)",
  code: "var(--warn)",
  quote: "var(--text-muted)",
  text: "var(--text-primary)",
};
