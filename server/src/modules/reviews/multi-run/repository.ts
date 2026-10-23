import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/** An agent as needed to queue its run (a subset of AgentRow). */
export type MultiRunAgent = { id: string; provider: string | null; model: string | null };

/**
 * L07 multi-agent run data-access: the `multi_agent_runs` parent and its
 * linked child `agent_runs` (`multi_agent_run_id`, migration 0016).
 */
export class MultiRunRepository {
  constructor(private db: Db) {}

  /**
   * Create the parent and one `running` child per agent in ONE transaction:
   * a failure in any insert rolls everything back, so a request leaves either
   * the whole multi-run or nothing. Children get `ran_at = t0 + i ms` (i = list
   * position): inside a transaction `now()` is the same for every row, which
   * would make column order fall back to the random run id (AC-MAR-53).
   * Returns the child run ids in `agents` order. Do not await slow I/O here.
   */
  async createMultiRun(input: {
    workspaceId: string;
    prId: string;
    agents: readonly MultiRunAgent[];
    startedAt?: Date;
  }): Promise<{ multiAgentRunId: string; runIds: string[] }> {
    if (input.agents.length === 0) throw new Error('createMultiRun: no agents');
    const t0 = input.startedAt ?? new Date();
    return this.db.transaction(async (tx) => {
      const [parent] = await tx
        .insert(t.multiAgentRuns)
        .values({ workspaceId: input.workspaceId, prId: input.prId, ranAt: t0 })
        .returning({ id: t.multiAgentRuns.id });
      const children = await tx
        .insert(t.agentRuns)
        .values(
          input.agents.map((agent, i) => ({
            workspaceId: input.workspaceId,
            agentId: agent.id,
            prId: input.prId,
            provider: agent.provider,
            model: agent.model,
            status: 'running',
            source: 'local' as const,
            multiAgentRunId: parent!.id,
            ranAt: new Date(t0.getTime() + i),
          })),
        )
        .returning({ id: t.agentRuns.id, agentId: t.agentRuns.agentId });
      // Map back by agent (ids are distinct after normalizeAgentIds) instead of
      // trusting RETURNING order.
      const runIdByAgent = new Map(children.map((c) => [c.agentId, c.id]));
      const runIds = input.agents.map((agent) => {
        const runId = runIdByAgent.get(agent.id);
        if (!runId) throw new Error(`createMultiRun: no run created for agent ${agent.id}`);
        return runId;
      });
      return { multiAgentRunId: parent!.id, runIds };
    });
  }
}
