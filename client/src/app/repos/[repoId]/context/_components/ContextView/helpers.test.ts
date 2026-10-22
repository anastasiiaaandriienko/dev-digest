import { describe, it, expect } from "vitest";
import { approxTotalTokens, fileName } from "./helpers";

describe("ContextView helpers", () => {
  it("fileName returns the last path segment", () => {
    expect(fileName("docs/adr/0001.md")).toBe("0001.md");
    expect(fileName("README.md")).toBe("README.md");
  });

  it("approxTotalTokens sums bytes / 4 per doc, rounded up per doc (0 for an empty list)", () => {
    expect(approxTotalTokens([{ size: 2048 }, { size: 512 }])).toBe(640);
    expect(approxTotalTokens([{ size: 1 }, { size: 1 }])).toBe(2);
    expect(approxTotalTokens([])).toBe(0);
  });
});
