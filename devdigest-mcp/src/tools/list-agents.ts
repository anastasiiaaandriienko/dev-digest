import { z } from 'zod';
import { clip, fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const LIST_AGENTS = 'list_agents';

const AgentOut = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  strategy: z.string().nullable(),
  skill_count: z.number().nullable(),
});

export const listAgentsInput = {
  enabled_only: z.boolean().default(false).describe('Return only enabled agents.'),
};
export const listAgentsOutput = {
  count: z.number(),
  agents: z.array(AgentOut),
};

export const listAgentsConfig = {
  title: 'List DevDigest review agents',
  description:
    'Lists the AI review agents configured in DevDigest (GET /agents) with their ids, model and enabled state. ' +
    'Use an id from here as agent_id for run_agent_on_pr or get_findings. Read-only; no system prompts are returned.',
  inputSchema: listAgentsInput,
  outputSchema: listAgentsOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export async function listAgents(deps: ToolDeps, input: { enabled_only?: boolean }): Promise<ToolResult> {
  try {
    const all = await deps.api.listAgents();
    const agents = all
      .filter((a) => !input.enabled_only || a.enabled)
      .map((a) => ({
        id: a.id,
        name: a.name,
        description: clip(a.description, 300),
        enabled: a.enabled,
        provider: a.provider ?? null,
        model: a.model ?? null,
        strategy: a.strategy ?? null,
        skill_count: a.skill_count ?? null,
      }));
    const text =
      agents.length === 0
        ? 'No agents found.'
        : agents.map((a) => `- ${a.name} (${a.id}) — ${a.enabled ? 'enabled' : 'disabled'}, ${a.provider ?? '?'}/${a.model ?? '?'}`).join('\n');
    return ok(text, { count: agents.length, agents });
  } catch (err) {
    return fail(err);
  }
}
