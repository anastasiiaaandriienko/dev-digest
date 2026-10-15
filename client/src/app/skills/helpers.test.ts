import { describe, it, expect } from "vitest";
import { validateSkillForm } from "./helpers";

/** Shared by CreateSkillModal and the skill page's ConfigTab; mirrors the server's SkillCreate limits. */
describe("validateSkillForm", () => {
  const ok = { name: "a", description: "", type: "custom" as const, body: "# x" };
  it("accepts a valid form and trims the name", () => {
    expect(validateSkillForm({ ...ok, name: "  a  " })).toEqual({ ok: true, data: ok });
  });
  it("flags each invalid field with the shared contract's limits", () => {
    expect(validateSkillForm({ ...ok, name: " ", body: "" })).toEqual({ ok: false, errors: { name: true, body: true } });
    expect(validateSkillForm({ ...ok, description: "x".repeat(2001) })).toEqual({ ok: false, errors: { description: true } });
    expect(validateSkillForm({ ...ok, name: "x".repeat(121) })).toEqual({ ok: false, errors: { name: true } });
  });
});
