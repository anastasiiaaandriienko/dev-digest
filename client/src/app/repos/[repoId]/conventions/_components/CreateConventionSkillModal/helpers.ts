// Runtime import from the contract file itself (a value import from the barrel breaks `next build`).
import { ConventionSkillCreate } from "@devdigest/shared/contracts/knowledge";
import type { SkillType } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/** The modal's editable fields (`agentId: ""` = don't attach). */
export interface SkillForm {
  name: string;
  description: string;
  type: SkillType;
  enabled: boolean;
  body: string;
  agentId: string;
}

export type SkillFormErrors = Partial<Record<keyof SkillForm, string>>;

const FIELD: Record<string, keyof SkillForm> = {
  name: "name",
  description: "description",
  type: "type",
  enabled: "enabled",
  body: "body",
  agent_id: "agentId",
};

/** Check the form with the same contract the server enforces; first message per field. */
export function validateForm(
  form: SkillForm,
): { ok: true; data: ConventionSkillCreate } | { ok: false; errors: SkillFormErrors } {
  const res = ConventionSkillCreate.safeParse({
    name: form.name,
    description: form.description,
    type: form.type,
    enabled: form.enabled,
    body: form.body,
    agent_id: form.agentId || null,
  });
  if (res.success) return { ok: true, data: res.data };
  const errors: SkillFormErrors = {};
  for (const issue of res.error.issues) {
    const key = FIELD[String(issue.path[0])] ?? "body";
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** One entry of a 422 `details` array as the API sends it (fastify-type-provider-zod). */
interface ValidationDetail {
  instancePath?: string;
  params?: { issue?: { path?: (string | number)[] } };
  message?: string;
}

/**
 * Field errors for a failed create: 409 → the name is taken (keep everything
 * else), 422 → the server's field messages, 404 → the chosen agent is gone.
 */
export function errorsFromApi(err: unknown, nameTaken: (name: string) => string): SkillFormErrors {
  if (!(err instanceof ApiError)) return {};
  if (err.status === 409) {
    const name = (err.details as { names?: string[] })?.names?.[0] ?? "";
    return { name: nameTaken(name) };
  }
  if (err.status === 404) return { agentId: err.message };
  if (err.status === 422 && Array.isArray(err.details)) {
    const errors: SkillFormErrors = {};
    for (const d of err.details as ValidationDetail[]) {
      const path = d.params?.issue?.path ?? (d.instancePath ?? "").split("/").filter(Boolean);
      const key = FIELD[String(path[0])] ?? "body";
      errors[key] ??= d.message ?? err.message;
    }
    return errors;
  }
  if (err.status === 422) return { body: err.message };
  return {};
}
