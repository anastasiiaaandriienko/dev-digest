import { describe, it, expect } from "vitest";
import { diffTokens } from "./helpers";

const side = (tokens: ReturnType<typeof diffTokens>["tokens"], which: "base" | "head") =>
  tokens.filter((t) => t.k === "same" || t.k === (which === "base" ? "del" : "add")).map((t) => t.t).join("");

describe("diffTokens (word-level prompt diff)", () => {
  it("marks nothing for identical prompts", () => {
    const { tokens, truncated } = diffTokens("You are a reviewer.\nCite lines.", "You are a reviewer.\nCite lines.");
    expect(tokens.every((t) => t.k === "same")).toBe(true);
    expect(truncated).toBe(false);
  });

  it("marks added and deleted words and keeps line breaks", () => {
    const a = "Return at most 5 findings.\nCite file and line.";
    const b = "Return at most 5 findings.\nFlag unused imports.\nCite file and line.";
    const { tokens } = diffTokens(a, b);
    expect(tokens.filter((t) => t.k === "add").map((t) => t.t).join("")).toContain("unused");
    expect(tokens.some((t) => t.k === "del")).toBe(false);
    expect(side(tokens, "base")).toBe(a);
    expect(side(tokens, "head")).toBe(b);
  });

  it("reconstructs both prompts exactly from a mixed change", () => {
    const a = "You are a PR reviewer. Look for security problems in the diff.";
    const b = "You are a security-focused PR reviewer. Look for hardcoded secrets in the diff and report them.";
    const { tokens } = diffTokens(a, b);
    expect(side(tokens, "base")).toBe(a);
    expect(side(tokens, "head")).toBe(b);
    expect(tokens.some((t) => t.k === "del" && t.t === "problems")).toBe(true);
  });

  it("caps the differing middle and reports truncation (no runaway LCS table)", () => {
    const a = Array.from({ length: 200 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 200 }, (_, i) => `b${i}`).join(" ");
    const { tokens, truncated } = diffTokens(a, b, 50);
    expect(truncated).toBe(true);
    expect(tokens.length).toBeLessThanOrEqual(100);
  });

  it("handles empty prompts", () => {
    expect(diffTokens("", "").tokens).toEqual([]);
    expect(diffTokens("", "new").tokens).toEqual([{ t: "new", k: "add" }]);
  });
});
