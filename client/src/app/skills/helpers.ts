// Runtime (not type-only) import: take it from the contract file itself. The
// `@devdigest/shared` barrel re-exports with `.js` specifiers that Next's webpack
// cannot resolve to `.ts`, so a value import from the barrel breaks `next build`.
import { SkillCreate } from "@devdigest/shared/contracts/knowledge";
import type { SkillType } from "@devdigest/shared";

export interface SkillFormValues {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export type SkillFormField = "name" | "description" | "body";

export type SkillFormResult =
  | { ok: true; data: SkillFormValues }
  | { ok: false; errors: Partial<Record<SkillFormField, true>> };

/**
 * Validate the create form with the SAME contract the server enforces
 * (`SkillCreate`), so inline errors and the API agree. Returns the parsed
 * (trimmed) values or the fields that failed.
 */
export function validateSkillForm(values: SkillFormValues): SkillFormResult {
  const parsed = SkillCreate.safeParse(values);
  if (parsed.success) {
    const { name, description, type, body } = parsed.data;
    return { ok: true, data: { name, description, type, body } };
  }
  const errors: Partial<Record<SkillFormField, true>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "description" || field === "body") errors[field] = true;
  }
  return { ok: false, errors };
}
