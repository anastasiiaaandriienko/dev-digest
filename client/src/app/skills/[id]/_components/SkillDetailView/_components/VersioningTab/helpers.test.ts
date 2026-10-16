import { describe, it, expect } from "vitest";
import type { SkillVersion } from "@devdigest/shared";
import { sameBodyAs, versionSummaries, versionWhen } from "./helpers";

const v = (version: number, body: string): SkillVersion => ({
  skill_id: "s1",
  version,
  body,
  created_at: "2026-10-15T10:00:00.000Z",
  current: false,
});

describe("sameBodyAs", () => {
  it("links a version to the most recent older version with the same body", () => {
    // newest first, as the API returns it: v4 restored v1; v5 restored v2
    const map = sameBodyAs([v(5, "B"), v(4, "A"), v(3, "C"), v(2, "B"), v(1, "A")]);
    expect([...map.entries()].sort()).toEqual([
      [4, 1],
      [5, 2],
    ]);
  });

  it("all-distinct bodies → no links", () => {
    expect(sameBodyAs([v(2, "B"), v(1, "A")]).size).toBe(0);
  });
});

describe("versionSummaries", () => {
  it("oldest = initial; a repeated body = restore; otherwise the line delta vs the version before", () => {
    const map = versionSummaries([v(4, "a\nb"), v(3, "a\nb\nc"), v(2, "a\nx"), v(1, "a\nb")]);
    expect(map.get(1)).toEqual({ kind: "initial" });
    expect(map.get(2)).toEqual({ kind: "changed", prev: 1, added: 1, removed: 1 });
    expect(map.get(3)).toEqual({ kind: "changed", prev: 2, added: 2, removed: 1 });
    expect(map.get(4)).toEqual({ kind: "same", as: 1 });
  });

  it("no versions → empty", () => {
    expect(versionSummaries([]).size).toBe(0);
  });
});

describe("versionWhen", () => {
  it("compact local date + time, zero-padded (design: 2026-05-30)", () => {
    const local = new Date(2026, 4, 3, 9, 5); // 3 May 2026, 09:05 local
    expect(versionWhen(local.toISOString())).toBe("2026-05-03 09:05");
  });

  it("returns an unparseable value unchanged", () => {
    expect(versionWhen("not a date")).toBe("not a date");
  });
});
