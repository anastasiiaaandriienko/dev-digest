/* context-tokens.ts — approximate token counts of Project Context docs from their
   byte size (text length / 4, the UI's convention elsewhere), and the server's
   injection limits (server/src/modules/context/constants.ts L4–L6) mirrored here
   so the UI can warn before a review run skips docs. Estimates only: the server
   counts real tokens with its tokenizer. */

/** L4 — bytes read per doc. */
export const CONTEXT_DOC_BYTES = 32_768;
/** L5 — tokens per injected doc entry. */
export const CONTEXT_DOC_TOKENS = 4000;
/** L6 — Project-context tokens per prompt; docs beyond it are skipped. */
export const CONTEXT_PROMPT_TOKENS = 12_000;

/** Approximate tokens of a whole doc. */
export function approxDocTokens(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / 4);
}

/** Approximate tokens one doc adds to a review prompt: read cap (L4), then per-doc cap (L5). */
export function approxInjectedTokens(bytes: number): number {
  return Math.min(approxDocTokens(Math.min(bytes, CONTEXT_DOC_BYTES)), CONTEXT_DOC_TOKENS);
}

/** Sum of `approxInjectedTokens` over docs with a known size. */
export function approxInjectedTotal(sizes: readonly (number | undefined)[]): number {
  return sizes.reduce<number>((n, b) => (b === undefined ? n : n + approxInjectedTokens(b)), 0);
}
