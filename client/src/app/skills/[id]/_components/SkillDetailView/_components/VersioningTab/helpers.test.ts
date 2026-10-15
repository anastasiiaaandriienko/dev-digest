import { describe, it, expect } from "vitest";
import type { SkillVersion } from "@devdigest/shared";
import { sameBodyAs } from "./helpers";

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
