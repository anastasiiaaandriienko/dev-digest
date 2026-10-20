import { describe, it, expect } from "vitest";
import { fileName, totalSize } from "./helpers";

describe("ContextView helpers", () => {
  it("fileName returns the last path segment", () => {
    expect(fileName("docs/adr/0001.md")).toBe("0001.md");
    expect(fileName("README.md")).toBe("README.md");
  });

  it("totalSize sums the sizes (0 for an empty list)", () => {
    expect(totalSize([{ size: 2048 }, { size: 512 }])).toBe(2560);
    expect(totalSize([])).toBe(0);
  });
});
