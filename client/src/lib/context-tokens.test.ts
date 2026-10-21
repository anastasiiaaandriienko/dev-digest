import { describe, it, expect } from "vitest";
import {
  CONTEXT_DOC_BYTES,
  CONTEXT_DOC_TOKENS,
  approxDocTokens,
  approxInjectedTokens,
  approxInjectedTotal,
} from "./context-tokens";

describe("context-tokens", () => {
  it("approximates a doc as bytes / 4, rounded up", () => {
    expect(approxDocTokens(0)).toBe(0);
    expect(approxDocTokens(1)).toBe(1);
    expect(approxDocTokens(4000)).toBe(1000);
    expect(approxDocTokens(-5)).toBe(0);
  });

  it("caps what one doc can add to a prompt at the read and per-doc limits", () => {
    expect(approxInjectedTokens(8000)).toBe(2000);
    // 20 kB → 5000 tokens, capped at L5.
    expect(approxInjectedTokens(20_000)).toBe(CONTEXT_DOC_TOKENS);
    // Beyond L4 only the first 32 kB are read (still capped at L5).
    expect(approxInjectedTokens(CONTEXT_DOC_BYTES * 10)).toBe(CONTEXT_DOC_TOKENS);
  });

  it("sums known sizes and skips unknown ones", () => {
    expect(approxInjectedTotal([4000, undefined, 20_000])).toBe(1000 + CONTEXT_DOC_TOKENS);
    expect(approxInjectedTotal([])).toBe(0);
  });
});
