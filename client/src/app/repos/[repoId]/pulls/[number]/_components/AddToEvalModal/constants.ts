/* Limits of the eval-case form — the same rules as the contract
   `CreateEvalCaseFromFinding` (vendor/shared/contracts/eval-ci.ts); a test keeps
   them in sync. The schema itself is not imported at runtime (see helpers.ts). */

export const EVAL_CASE_NAME_MAX = 80;
export const EVAL_CASE_NOTES_MAX = 500;
export const EVAL_CASE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Error codes of `POST /findings/:id/eval-case` that have their own message. */
export const EVAL_CASE_ERROR_CODES = [
  "eval_case_exists",
  "duplicate_location",
  "conflicting_label",
  "range_too_wide",
  "location_not_in_diff",
  "diff_unavailable",
  "diff_too_large",
  "finding_not_decided",
  "finding_has_no_agent",
] as const;
export type EvalCaseErrorCode = (typeof EVAL_CASE_ERROR_CODES)[number];
