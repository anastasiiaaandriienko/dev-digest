import { z } from 'zod/v4';
import { clip, fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const LIST_AGENTS = 'list_agents';

/** Public contract: exactly these five fields; anything else the API returns is dropped. */
const AgentOut = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  model: z.string().nullable(),
  enabled: z.boolean(),
});

export const listAgentsInput = {
  enabled_only: z.boolean().default(false).describe('Return only enabled agents.'),
};
export const listAgentsOutput = {
  count: z.number(),
  agents: z.array(AgentOut),
};

export const listAgentsConfig = {
  description:
    'Lists the AI review agents configured in DevDigest (GET /agents) with their ids, model and enabled state. ' +
    'Use an id from here as agent_id for run_agent_on_pr. Read-only; no system prompts are returned.',
  inputSchema: listAgentsInput,
  outputSchema: listAgentsOutput,
  annotations: { readOnlyHint: true },
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
        model: a.model ?? null,
        enabled: a.enabled,
      }));
    const text =
      agents.length === 0
        ? 'No agents found.'
        : agents.map((a) => `- ${a.name} (${a.id}) — ${a.enabled ? 'enabled' : 'disabled'}, model ${a.model ?? '?'}`).join('\n');
    return ok(text, { count: agents.length, agents });
  } catch (err) {
    return fail(err);
  }
}
