import type { Agent, CiFailOn, Provider, ReviewStrategy } from "@devdigest/shared";

/** The editable fields of the Config tab. */
export interface AgentForm {
  name: string;
  description: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  strategy: ReviewStrategy;
  ci_fail_on: CiFailOn;
  repo_intel: boolean;
  enabled: boolean;
}

export type AgentPatch = Partial<AgentForm>;
export type AgentFormField = "name" | "model" | "system_prompt";

export function formFrom(agent: Agent): AgentForm {
  return {
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.system_prompt,
    strategy: agent.strategy,
    ci_fail_on: agent.ci_fail_on,
    repo_intel: agent.repo_intel,
    enabled: agent.enabled,
  };
}

/** Only the fields that differ from the saved agent; `name` is compared trimmed, as stored. */
export function changedFields(agent: Agent, form: AgentForm): AgentPatch {
  const patch: AgentPatch = {};
  if (form.name.trim() !== agent.name) patch.name = form.name.trim();
  if (form.description !== agent.description) patch.description = form.description;
  if (form.provider !== agent.provider) patch.provider = form.provider;
  if (form.model !== agent.model) patch.model = form.model;
  if (form.system_prompt !== agent.system_prompt) patch.system_prompt = form.system_prompt;
  if (form.strategy !== agent.strategy) patch.strategy = form.strategy;
  if (form.ci_fail_on !== agent.ci_fail_on) patch.ci_fail_on = form.ci_fail_on;
  if (form.repo_intel !== agent.repo_intel) patch.repo_intel = form.repo_intel;
  if (form.enabled !== agent.enabled) patch.enabled = form.enabled;
  return patch;
}

/** The server's rules (name, model and system prompt must not be empty), checked before saving. */
export function invalidFields(form: AgentForm): Partial<Record<AgentFormField, true>> {
  const errors: Partial<Record<AgentFormField, true>> = {};
  if (!form.name.trim()) errors.name = true;
  if (!form.model.trim()) errors.model = true;
  if (!form.system_prompt.trim()) errors.system_prompt = true;
  return errors;
}

/** Approximate token count (text length / 4, as in the design header). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
