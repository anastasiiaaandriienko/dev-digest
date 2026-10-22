import { describe, it, expect } from "vitest";
import type { ContextAttachment, ContextListItem } from "@devdigest/shared";
import { attachedTokens, buildRows, dropOn, filterRows, formatKb, moveBy, rootOf, splitPath } from "./helpers";

describe("attachedTokens", () => {
  const a = (path: string, status: ContextAttachment["status"] = "ok"): ContextAttachment => ({
    id: path,
    repo_id: "r1",
    path,
    order: 0,
    status,
  });
  it("counts ok attachments with a known size, capped per doc", () => {
    const files: ContextListItem[] = [
      { path: "docs/a.md", size: 400, updated_at: "x" },
      { path: "docs/b.md", size: 100_000, updated_at: "x" },
      { path: "docs/c.md", size: 800, updated_at: "x" },
    ];
    expect(attachedTokens([a("docs/a.md"), a("docs/b.md"), a("docs/c.md", "outside_roots"), a("docs/x.md")], files)).toBe(
      100 + 4000,
    );
    expect(attachedTokens([], files)).toBe(0);
  });
});

const file = (path: string, size = 100): ContextListItem => ({ path, size, updated_at: "x" });
const att = (id: string, path: string, order: number): ContextAttachment => ({
  id,
  repo_id: "r1",
  path,
  order,
  status: "ok",
});

describe("ContextTab helpers", () => {
  it("AC-CTX-82 rootOf picks the longest root", () => {
    const roots = ["docs", "docs/adr", ".devdigest/specs"];
    expect(rootOf("docs/adr/0001.md", roots)).toBe("docs/adr");
    expect(rootOf("docs/spec.md", roots)).toBe("docs");
    expect(rootOf(".devdigest/specs/a.md", roots)).toBe(".devdigest/specs");
    expect(rootOf("docs-old/a.md", roots)).toBeNull();
    expect(rootOf("README.md", roots)).toBeNull();
  });

  it("AC-CTX-82 splitPath separates filename and folder", () => {
    expect(splitPath("docs/adr/0001.md")).toEqual({ name: "0001.md", folder: "docs/adr" });
    expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
  });

  it("AC-CTX-83 buildRows order: attachments in server order, then unattached in discovery order", () => {
    const rows = buildRows(
      [att("a2", "docs/b.md", 1), att("a1", "gone.md", 2)],
      [file("docs/a.md"), file("docs/b.md", 2048), file("docs/c.md")],
    );
    expect(rows.map((r) => [r.path, r.attached])).toEqual([
      ["docs/b.md", true],
      ["gone.md", true],
      ["docs/a.md", false],
      ["docs/c.md", false],
    ]);
    expect(rows[0]).toMatchObject({ attachmentId: "a2", size: 2048 });
    expect(rows[1]!.size).toBeUndefined();
  });

  it("AC-CTX-90 filterRows is case-insensitive", () => {
    const rows = buildRows([], [file("docs/Spec.md"), file("docs/adr/0001.md")]);
    expect(filterRows(rows, "SPEC").map((r) => r.path)).toEqual(["docs/Spec.md"]);
    expect(filterRows(rows, "  ")).toHaveLength(2);
  });

  it("AC-CTX-105 formatKb shows kilobytes", () => {
    expect(formatKb(512)).toBe("0.5");
    expect(formatKb(20 * 1024)).toBe("20");
  });

  it("AC-CTX-95 moveBy/dropOn return all ids in the new order", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveBy(ids, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(moveBy(ids, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(moveBy(ids, "a", -1)).toEqual(ids);
    expect(moveBy(ids, "d", 1)).toEqual(ids);
    expect(dropOn(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(dropOn(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(dropOn(ids, "a", "a")).toEqual(ids);
    expect(dropOn(ids, "a", "zz")).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});
