/** How one Markdown line is coloured in the body editor (design: Skill Editor · Config). */
export type LineKind = "heading" | "list" | "fence" | "code" | "quote" | "text";

/**
 * Classify every line of a Markdown body for the editor's highlighting.
 * Lines between ``` fences are `code` (and are never read as headings or lists);
 * the fences themselves are `fence`. Pure: same input, same output.
 */
export function classifyLines(body: string): LineKind[] {
  let inFence = false;
  return body.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "fence";
    }
    if (inFence) return "code";
    if (/^#{1,6}\s/.test(line)) return "heading";
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) return "list";
    if (/^\s*>/.test(line)) return "quote";
    return "text";
  });
}

/** Approximate token count (text length / 4, as in the design header). */
export function approxTokens(body: string): number {
  return Math.ceil(body.length / 4);
}
