import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './tools/deps.js';
import { LIST_AGENTS, listAgents, listAgentsConfig } from './tools/list-agents.js';
import { RUN_AGENT_ON_PR, runAgentConfig, runAgentOnPr } from './tools/run-agent-on-pr.js';
import { GET_FINDINGS, getFindings, getFindingsConfig } from './tools/get-findings.js';
import { GET_CONVENTIONS, getConventions, getConventionsConfig } from './tools/get-conventions.js';
import { GET_BLAST_RADIUS, getBlastRadius, getBlastRadiusConfig } from './tools/get-blast-radius.js';

export const SERVER_NAME = 'devdigest';
export const SERVER_VERSION = '0.1.0';

/** The exact set of tools this server exposes (L04). */
export const TOOL_NAMES = [LIST_AGENTS, RUN_AGENT_ON_PR, GET_FINDINGS, GET_CONVENTIONS, GET_BLAST_RADIUS] as const;

/** Build the MCP server with its five tools. Transport-agnostic (stdio in index.ts, in-memory in tests). */
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  server.registerTool(LIST_AGENTS, listAgentsConfig, (args) => listAgents(deps, args));
  server.registerTool(RUN_AGENT_ON_PR, runAgentConfig, (args, extra) => {
    // Progress notifications keep clients that reset their timeout on progress waiting.
    const token = extra._meta?.progressToken;
    const onProgress =
      token === undefined
        ? undefined
        : (progress: number, total: number, message: string) =>
            extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress, total, message } });
    return runAgentOnPr(deps, args, onProgress);
  });
  server.registerTool(GET_FINDINGS, getFindingsConfig, (args) => getFindings(deps, args));
  server.registerTool(GET_CONVENTIONS, getConventionsConfig, (args) => getConventions(deps, args));
  server.registerTool(GET_BLAST_RADIUS, getBlastRadiusConfig, (args) => getBlastRadius(deps, args));
  return server;
}
