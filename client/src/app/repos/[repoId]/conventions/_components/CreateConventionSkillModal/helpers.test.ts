import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { errorsFromApi, validateForm, type SkillForm } from "./helpers";

const FORM: SkillForm = {
  name: "repo-conventions",
  description: "3 house conventions",
  type: "convention",
  enabled: true,
  body: "# rules\n- Use zod",
  agentId: "",
};
const taken = (n: string) => `taken:${n}`;

describe("validateForm (shared ConventionSkillCreate rules)", () => {
  it("a valid form becomes the request body; no agent → agent_id null", () => {
    expect(validateForm(FORM)).toEqual({
      ok: true,
      data: { name: "repo-conventions", description: "3 house conventions", type: "convention", enabled: true, body: "# rules\n- Use zod", agent_id: null },
    });
    const agent = "6f1c2b0e-8d6a-4f7e-9a3b-2c1d0e9f8a7b";
    expect(validateForm({ ...FORM, agentId: agent })).toMatchObject({ ok: true, data: { agent_id: agent } });
  });

  it("reports the first problem per field", () => {
    const res = validateForm({ ...FORM, name: "Repo Conventions", body: "# x\n<script>alert(1)</script>" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.name).toMatch(/^Use lowercase/);
      expect(res.errors.body).toMatch(/^Executable content is not allowed/);
    }
    const empty = validateForm({ ...FORM, body: "   " });
    expect(empty.ok || empty.errors.body).toBe("Body is empty");
  });
});

describe("errorsFromApi", () => {
  it("409 → the name is taken", () => {
    expect(errorsFromApi(new ApiError("dup", 409, "conflict", { names: ["repo-conventions"] }), taken)).toEqual({ name: "taken:repo-conventions" });
  });
  it("422 (API shape) → the field the server names", () => {
    const err = new ApiError("bad", 422, "validation_error", [
      { instancePath: "/body", params: { issue: { path: ["body"] } }, message: "Body is empty" },
      { instancePath: "/agent_id", message: "Invalid uuid" },
    ]);
    expect(errorsFromApi(err, taken)).toEqual({ body: "Body is empty", agentId: "Invalid uuid" });
    expect(errorsFromApi(new ApiError("Accept at least one convention first", 422, "validation_error"), taken)).toEqual({
      body: "Accept at least one convention first",
    });
  });
  it("404 → the agent; anything else → nothing field-specific", () => {
    expect(errorsFromApi(new ApiError("Agent not found", 404, "not_found"), taken)).toEqual({ agentId: "Agent not found" });
    expect(errorsFromApi(new ApiError("boom", 500), taken)).toEqual({});
    expect(errorsFromApi(new Error("network"), taken)).toEqual({});
  });
});
