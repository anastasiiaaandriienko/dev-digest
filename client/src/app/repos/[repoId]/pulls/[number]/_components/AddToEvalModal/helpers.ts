import type { EvalCaseKind, FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { lineLabel } from "../FindingCard/helpers";
import {
  EVAL_CASE_ERROR_CODES,
  EVAL_CASE_NAME_MAX,
  EVAL_CASE_NAME_PATTERN,
  EVAL_CASE_NOTES_MAX,
  type EvalCaseErrorCode,
} from "./constants";

/* Pure helpers of the "Add to eval set" modal. The contract schema is NOT
   imported at runtime: `eval-ci.ts` uses `.js` relative imports, which break
   `next build` (client/INSIGHTS.md, 2026-10-15). helpers.test.ts checks that
   `validateEvalCaseForm` agrees with `CreateEvalCaseFromFinding`. */

/** The label the server will derive: accepted → must_find, dismissed → must_not_flag. */
export function evalKindOf(f: Pick<FindingRecord, "accepted_at" | "dismissed_at">): EvalCaseKind | null {
  if (f.accepted_at) return "must_find";
  if (f.dismissed_at) return "must_not_flag";
  return null;
}

/** Same default as the server (`must-find-<slug>` / `no-<slug>`, design `findingToSeed`). */
export function defaultCaseName(kind: EvalCaseKind, title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "finding";
  return `${kind === "must_find" ? "must-find" : "no"}-${slug}`;
}

export type EvalCaseFormErrors = {
  name?: "nameRequired" | "nameFormat" | "nameTooLong";
  notes?: "notesTooLong";
};

/** Client-side validation by the contract rules; keys map to `finding.evalCase.validation.*`. */
export function validateEvalCaseForm(v: { name: string; notes: string }): EvalCaseFormErrors {
  const errors: EvalCaseFormErrors = {};
  if (v.name.length === 0) errors.name = "nameRequired";
  else if (v.name.length > EVAL_CASE_NAME_MAX) errors.name = "nameTooLong";
  else if (!EVAL_CASE_NAME_PATTERN.test(v.name)) errors.name = "nameFormat";
  if (v.notes.length > EVAL_CASE_NOTES_MAX) errors.notes = "notesTooLong";
  return errors;
}

/** The request body: name always, notes only when not blank. */
export function evalCaseBody(v: { name: string; notes: string }): { name: string; notes?: string } {
  const notes = v.notes.trim();
  return notes ? { name: v.name, notes } : { name: v.name };
}

/** `file:11` / `file:11-15`. */
export function locationOf(f: Pick<FindingRecord, "file" | "start_line" | "end_line">): string {
  return `${f.file}:${lineLabel(f)}`;
}

/** The expected-output preview of a must_find case (a dismissed case shows the empty assertion). */
export function expectedPreview(f: FindingRecord): string {
  return JSON.stringify(
    [{ severity: f.severity, category: f.category, title: f.title, file: f.file, start_line: f.start_line, end_line: f.end_line }],
    null,
    2,
  );
}

/** i18n key (under `finding.evalCase.errors`) for an API error. */
export function errorKeyOf(err: unknown): EvalCaseErrorCode | "generic" {
  if (err instanceof ApiError && (EVAL_CASE_ERROR_CODES as readonly string[]).includes(err.code ?? "")) {
    return err.code as EvalCaseErrorCode;
  }
  return "generic";
}
