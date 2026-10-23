import { describe, it, expect } from "vitest";
import { initialSelection, isAtLimit, pruneSelection, toggleSelection } from "./helpers";

/** L07 T8 — pure picker selection rules. */

const ag = (id: string, enabled = true) => ({ id, enabled });

describe("picker selection", () => {
  it("pre-checks enabled agents in list order, capped at 8", () => {
    expect(initialSelection([ag("a"), ag("b", false), ag("c")])).toEqual(["a", "c"]);
    const ten = Array.from({ length: 10 }, (_, i) => ag(`a${i}`));
    expect(initialSelection(ten)).toHaveLength(8);
    expect(initialSelection([])).toEqual([]);
  });

  it("toggling appends (pick order) and removes", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });

  it("never exceeds the limit, but unchecking at the limit still works", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `a${i}`);
    expect(isAtLimit(eight)).toBe(true);
    expect(toggleSelection(eight, "x")).toEqual(eight);
    expect(toggleSelection(eight, "a0")).toHaveLength(7);
    expect(toggleSelection(["a"], "b", 1)).toEqual(["a"]);
  });

  it("drops agents that no longer exist", () => {
    expect(pruneSelection(["a", "gone", "b"], [ag("a"), ag("b")])).toEqual(["a", "b"]);
  });
});
