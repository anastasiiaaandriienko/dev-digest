import { describe, it, expect } from "vitest";
import { CreateEvalCaseFromFinding } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { defaultCaseName, errorKeyOf, evalCaseBody, evalKindOf, locationOf, validateEvalCaseForm } from "./helpers";

describe("evalKindOf", () => {
  it("accepted → must_find, dismissed → must_not_flag, undecided → null", () => {
    expect(evalKindOf({ accepted_at: "t", dismissed_at: null })).toBe("must_find");
    expect(evalKindOf({ accepted_at: null, dismissed_at: "t" })).toBe("must_not_flag");
    expect(evalKindOf({ accepted_at: null, dismissed_at: null })).toBeNull();
  });
});

describe("defaultCaseName (same as the server default)", () => {
  it("builds must-find-<slug> / no-<slug>", () => {
    expect(defaultCaseName("must_find", "Hardcoded Stripe secret key!")).toBe("must-find-hardcoded-stripe-secret-key");
    expect(defaultCaseName("must_not_flag", "Unused import")).toBe("no-unused-import");
    expect(defaultCaseName("must_find", "!!!")).toBe("must-find-finding");
  });
});

describe("validateEvalCaseForm agrees with the contract CreateEvalCaseFromFinding", () => {
  const samples = [
    { name: "must-find-x", notes: "" },
    { name: "0-starts-with-digit", notes: "ok" },
    { name: "", notes: "" },
    { name: "Has Space", notes: "" },
    { name: "-leading-dash", notes: "" },
    { name: "UPPER", notes: "" },
    { name: "a".repeat(80), notes: "" },
    { name: "a".repeat(81), notes: "" },
    { name: "ok", notes: "n".repeat(500) },
    { name: "ok", notes: "n".repeat(501) },
  ];
  it.each(samples)("name=%s", (v) => {
    const clientOk = Object.keys(validateEvalCaseForm(v)).length === 0;
    const contractOk = CreateEvalCaseFromFinding.safeParse(evalCaseBody(v)).success;
    expect(clientOk).toBe(contractOk);
  });

  it("names the failing rule", () => {
    expect(validateEvalCaseForm({ name: "", notes: "" }).name).toBe("nameRequired");
    expect(validateEvalCaseForm({ name: "Bad", notes: "" }).name).toBe("nameFormat");
    expect(validateEvalCaseForm({ name: "a".repeat(81), notes: "" }).name).toBe("nameTooLong");
    expect(validateEvalCaseForm({ name: "ok", notes: "n".repeat(501) }).notes).toBe("notesTooLong");
  });
});

describe("evalCaseBody / locationOf / errorKeyOf", () => {
  it("omits blank notes and trims the rest; never sends a label", () => {
    expect(evalCaseBody({ name: "n", notes: "   " })).toEqual({ name: "n" });
    expect(evalCaseBody({ name: "n", notes: " why " })).toEqual({ name: "n", notes: "why" });
  });

  it("formats file:line and file:start-end", () => {
    expect(locationOf({ file: "src/a.ts", start_line: 3, end_line: 3 })).toBe("src/a.ts:3");
    expect(locationOf({ file: "src/a.ts", start_line: 3, end_line: 7 })).toBe("src/a.ts:3-7");
  });

  it("maps documented API codes and falls back to generic", () => {
    for (const code of ["eval_case_exists", "duplicate_location", "conflicting_label", "range_too_wide", "location_not_in_diff", "diff_unavailable"]) {
      expect(errorKeyOf(new ApiError("x", 409, code))).toBe(code);
    }
    expect(errorKeyOf(new ApiError("x", 500, "internal_error"))).toBe("generic");
    expect(errorKeyOf(new Error("network"))).toBe("generic");
  });
});
