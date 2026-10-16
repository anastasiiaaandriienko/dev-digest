import { describe, it, expect } from "vitest";
import { formatCost } from "./format";

describe("formatCost (L01 cost badge)", () => {
  it.each([
    [null, "—"],
    [undefined, "—"],
    [Number.NaN, "—"],
  ])("unknown %s → em dash, never $0.00", (value, expected) => {
    expect(formatCost(value)).toBe(expected);
  });

  it("unknown uses the caller's label (trace shows n/a)", () => {
    expect(formatCost(null, { unknown: "n/a" })).toBe("n/a");
    expect(formatCost(undefined, { unknown: "n/a" })).toBe("n/a");
  });

  it("a known zero is $0.00, distinct from unknown", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0, { unknown: "n/a" })).toBe("$0.00");
  });

  it.each([
    [0.001, "$0.001"],
    [0.001234, "$0.00123"],
    [0.0012345, "$0.00123"],
    [0.000456, "$0.000456"],
    [0.0000001, "$0.0000001"],
    [0.06, "$0.06"],
    [0.4234, "$0.423"],
    [0.42, "$0.42"],
    [0.5, "$0.50"],
    [0.9996, "$1.00"],
  ])("small nonzero %s keeps ≥ 3 significant digits → %s", (value, expected) => {
    expect(formatCost(value)).toBe(expected);
  });

  it.each([
    [1, "$1.00"],
    [1.234, "$1.23"],
    [12.345, "$12.35"],
    [1234.5, "$1,234.50"],
  ])("amounts ≥ $1 use two decimals: %s → %s", (value, expected) => {
    expect(formatCost(value)).toBe(expected);
  });

  it("partial prefixes a known figure, but not an unknown one", () => {
    expect(formatCost(0.42, { partial: true })).toBe("≥ $0.42");
    expect(formatCost(0.001, { partial: true })).toBe("≥ $0.001");
    expect(formatCost(null, { partial: true })).toBe("—");
  });
});
