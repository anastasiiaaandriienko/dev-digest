import { describe, it, expect } from "vitest";
import { approxTokens, classifyLines } from "./helpers";

describe("classifyLines", () => {
  it("headings, lists, quotes and plain text", () => {
    expect(classifyLines("# Title\n- item\n1. step\n> note\nplain\n")).toEqual([
      "heading",
      "list",
      "list",
      "quote",
      "text",
      "text",
    ]);
  });

  it("lines inside a code fence are code, never headings or lists", () => {
    expect(classifyLines("```ts\n# not a heading\n- not a list\n```\n## after")).toEqual([
      "fence",
      "code",
      "code",
      "fence",
      "heading",
    ]);
  });

  it("'#' without a space is not a heading", () => {
    expect(classifyLines("#hashtag")).toEqual(["text"]);
  });
});

describe("approxTokens", () => {
  it("is length / 4, rounded up", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("abcde")).toBe(2);
  });
});
