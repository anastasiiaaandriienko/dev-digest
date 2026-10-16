import { describe, it, expect } from "vitest";
import type { Skill } from "@devdigest/shared";
import { bodyStats, changedFields, formFrom } from "./helpers";

const SKILL: Skill = {
  id: "s1",
  name: "breaking-change",
  description: "d",
  type: "security",
  source: "manual",
  body: "# a\nb",
  enabled: true,
  version: 2,
  evidence_files: null,
  agent_count: 0,
};

describe("changedFields", () => {
  it("an untouched form changes nothing", () => {
    expect(changedFields(SKILL, formFrom(SKILL))).toEqual({});
  });

  it("returns only the edited fields (metadata edits never resend the body)", () => {
    expect(changedFields(SKILL, { ...formFrom(SKILL), description: "new", enabled: false })).toEqual({
      description: "new",
      enabled: false,
    });
    expect(changedFields(SKILL, { ...formFrom(SKILL), body: "# a\nc" })).toEqual({ body: "# a\nc" });
  });

  it("compares the name trimmed, as the server stores it", () => {
    expect(changedFields(SKILL, { ...formFrom(SKILL), name: "  breaking-change " })).toEqual({});
    expect(changedFields(SKILL, { ...formFrom(SKILL), name: " renamed " })).toEqual({ name: "renamed" });
  });
});

describe("bodyStats", () => {
  it("counts lines and ~tokens (length / 4, rounded up)", () => {
    expect(bodyStats("")).toEqual({ lines: 0, tokens: 0 });
    expect(bodyStats("abcd")).toEqual({ lines: 1, tokens: 1 });
    expect(bodyStats("abcde\nf")).toEqual({ lines: 2, tokens: 2 });
  });
});
