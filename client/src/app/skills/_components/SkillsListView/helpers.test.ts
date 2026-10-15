import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { filterSkills, previewedSkill } from "./helpers";

const sk = (id: string, description = ""): Skill => ({
  id,
  name: id,
  description,
  type: "custom",
  source: "manual",
  body: "# x",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
});

describe("filterSkills", () => {
  const list = [sk("Breaking-Change", "API removals"), sk("naming", "camelCase")];
  it("blank query keeps all", () => expect(filterSkills(list, "  ")).toHaveLength(2));
  it("matches name or description, case-insensitively", () => {
    expect(filterSkills(list, "breaking").map((s) => s.id)).toEqual(["Breaking-Change"]);
    expect(filterSkills(list, "CAMEL").map((s) => s.id)).toEqual(["naming"]);
    expect(filterSkills(list, "none")).toEqual([]);
  });
});

describe("previewedSkill", () => {
  const list = [sk("a")];
  it("no param → no drawer; loading → wait; unknown → null; known → the skill", () => {
    expect(previewedSkill(list, null)).toBeUndefined();
    expect(previewedSkill(undefined, "a")).toBeUndefined();
    expect(previewedSkill(list, "zzz")).toBeNull();
    expect(previewedSkill(list, "a")).toBe(list[0]);
  });
});
