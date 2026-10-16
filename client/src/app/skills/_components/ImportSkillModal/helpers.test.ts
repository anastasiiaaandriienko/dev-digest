import { describe, it, expect } from "vitest";
import type { SkillImportCandidate } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  applyImportError,
  bytesToBase64,
  draftIssues,
  draftsFrom,
  editDraft,
  fileProblem,
  itemsToImport,
  readAsBase64,
  rejectedEntries,
} from "./helpers";

const cand = (name: string, o: Partial<SkillImportCandidate> = {}): SkillImportCandidate => ({
  path: `${name}.md`,
  name,
  description: "",
  type: "custom",
  body: "# x",
  issues: [],
  ...o,
});
const dup = (n: string) => `dup:${n}`;

describe("file checks", () => {
  it("only .md / .zip, not empty, within the upload limit", () => {
    expect(fileProblem({ name: "a.md", size: 10 })).toBeNull();
    expect(fileProblem({ name: "Pack.ZIP", size: 10 })).toBeNull();
    for (const name of ["a.exe", "a.sh", "a.txt", "a.md.js", "md"]) expect(fileProblem({ name, size: 10 }), name).toBe("type");
    expect(fileProblem({ name: "a.md", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "a.zip", size: 2 * 1024 * 1024 + 1 })).toBe("size");
  });

  it("base64 of large binaries (chunked) round-trips", async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(atob(bytesToBase64(bytes)).length).toBe(bytes.length);
    expect(await readAsBase64(new Blob(["# hi"]))).toBe(btoa("# hi"));
  });
});

describe("drafts", () => {
  it("live issues: shared rules, server issues until the field is edited, duplicates among included drafts", () => {
    let drafts = draftsFrom([
      cand("Bad Name"),
      cand("taken", { issues: [{ field: "name", message: "A skill named \"taken\" already exists" }] }),
      cand("same"),
      cand("Same"),
    ]);
    expect(drafts.map((_, i) => draftIssues(drafts, i, dup).map((x) => x.message))).toEqual([
      [expect.stringMatching(/^Use lowercase/)],
      ['A skill named "taken" already exists'],
      ["dup:same"],
      [expect.stringMatching(/^Use lowercase/), "dup:Same"],
    ]);

    drafts = drafts.map((d, i) =>
      i === 0 ? editDraft(d, { name: "good-name" }) : i === 1 ? editDraft(d, { name: "renamed" }) : i === 3 ? editDraft(d, { include: false }) : d,
    );
    expect(drafts.map((_, i) => draftIssues(drafts, i, dup))).toEqual([[], [], [], []]);
  });

  it("editing one field keeps the server issues of the others", () => {
    const [d] = draftsFrom([cand("x", { issues: [{ field: "name", message: "taken" }, { field: "body", message: "bad" }] })]);
    expect(editDraft(d!, { body: "# fixed" }).serverIssues).toEqual([{ field: "name", message: "taken" }]);
  });

  it("only included drafts are sent, trimmed", () => {
    const drafts = draftsFrom([cand(" keep ", { description: " d " }), cand("drop")]).map((d, i) => (i === 1 ? editDraft(d, { include: false }) : d));
    expect(itemsToImport(drafts)).toEqual([{ name: "keep", description: "d", type: "custom", body: "# x" }]);
  });
});

describe("server errors back onto the drafts", () => {
  const drafts = draftsFrom([cand("a"), cand("b"), cand("c")]).map((d, i) => (i === 0 ? editDraft(d, { include: false }) : d));

  it("409 marks the taken names", () => {
    const out = applyImportError(drafts, new ApiError("taken", 409, "conflict", { names: ["C"] }), (n) => `taken:${n}`);
    expect(out.map((d) => d.serverIssues)).toEqual([[], [], [{ field: "name", message: "taken:c" }]]);
  });

  it("422 issues (the API's real shape) index the INCLUDED drafts", () => {
    // As fastify-type-provider-zod sends them: instancePath + params.issue (pinned by server test I10).
    const err = new ApiError("bad", 422, "validation_error", [
      { keyword: "custom", instancePath: "/items/0/body", params: { issue: { path: ["items", 0, "body"] } }, message: "Body is empty" },
      { keyword: "too_small", instancePath: "/items", params: { issue: { path: ["items"] } }, message: "x" },
    ]);
    expect(applyImportError(drafts, err, String).map((d) => d.serverIssues)).toEqual([[], [{ field: "body", message: "Body is empty" }], []]);
    // Without params.issue the instancePath alone is enough.
    const bare = new ApiError("bad", 422, "validation_error", [{ instancePath: "/items/1/name", message: "Name is required" }]);
    expect(applyImportError(drafts, bare, String).map((d) => d.serverIssues)).toEqual([[], [], [{ field: "name", message: "Name is required" }]]);
  });

  it("other errors change nothing; rejected archive entries are read from details", () => {
    expect(applyImportError(drafts, new Error("network"), String)).toEqual(drafts);
    const unsafe = new ApiError("unsafe", 422, "unsafe_archive", { entries: [{ path: "../x.md", reason: "path traversal (..)" }] });
    expect(rejectedEntries(unsafe)).toEqual([{ path: "../x.md", reason: "path traversal (..)" }]);
    expect(rejectedEntries(new Error("x"))).toEqual([]);
  });
});
