import { describe, it, expect } from "vitest";
import { diffLines, MAX_DIFF_CELLS } from "./helpers";

const rows = (before: string, after: string) =>
  diffLines(before, after).lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);

describe("diffLines", () => {
  it("identical bodies → only context lines, no changes", () => {
    const d = diffLines("a\nb", "a\nb");
    expect(d).toMatchObject({ added: 0, removed: 0 });
    expect(rows("a\nb", "a\nb")).toEqual([" a", " b"]);
  });

  it("a changed line is a removal followed by an addition, context kept", () => {
    expect(rows("# Rule\nold line\nend", "# Rule\nnew line\nend")).toEqual([" # Rule", "-old line", "+new line", " end"]);
    expect(diffLines("# Rule\nold line\nend", "# Rule\nnew line\nend")).toMatchObject({ added: 1, removed: 1 });
  });

  it("pure insertions and deletions", () => {
    expect(rows("a\nc", "a\nb\nc")).toEqual([" a", "+b", " c"]);
    expect(rows("a\nb\nc", "a\nc")).toEqual([" a", "-b", " c"]);
    expect(rows("", "x\ny")).toEqual(["+x", "+y"]);
    expect(rows("x", "")).toEqual(["-x"]);
  });

  it("numbers old and new lines like a unified diff", () => {
    const { lines } = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(lines).toEqual([
      { kind: "ctx", text: "a", oldNo: 1, newNo: 1 },
      { kind: "del", text: "b", oldNo: 2 },
      { kind: "add", text: "B", newNo: 2 },
      { kind: "ctx", text: "c", oldNo: 3, newNo: 3 },
      { kind: "add", text: "d", newNo: 4 },
    ]);
  });

  it("treats CRLF and LF bodies alike", () => {
    expect(diffLines("a\r\nb", "a\nb")).toMatchObject({ added: 0, removed: 0 });
  });

  it("very large bodies degrade to replace-all instead of an O(n·m) table", () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1 }, (_, i) => `l${i}`).join("\n");
    const d = diffLines(big, big + "\nx");
    expect(d.removed).toBeGreaterThan(0);
    expect(d.added).toBe(d.removed + 1);
  });
});
