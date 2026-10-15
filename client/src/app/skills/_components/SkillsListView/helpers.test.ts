import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { previewedSkill } from "./helpers";

const sk = (id: string): Skill => ({
  id,
  name: id,
  description: "",
  type: "custom",
  source: "manual",
  body: "# x",
  enabled: true,
  version: 1,
  evidence_files: null,
  agent_count: 0,
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
