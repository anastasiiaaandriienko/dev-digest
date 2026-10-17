import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { DevDigestApi } from './devdigest-api.js';
import { loadConfig } from './config.js';
import { stderrLogger } from './logger.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { realSleep } from './tools/deps.js';

/**
 * devdigest-mcp entry point: MCP over stdio. stdout carries ONLY the protocol;
 * logs go to stderr. The DevDigest API must be reachable at DEVDIGEST_API_BASE
 * for tool calls, but the server starts without it.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const api = new DevDigestApi(new ApiClient({ baseUrl: config.apiBase, timeoutMs: config.requestTimeoutMs }));
  const server = createServer({ api, config, logger: stderrLogger, sleep: realSleep, now: Date.now });
  await server.connect(new StdioServerTransport());
  stderrLogger.info(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio (API ${config.apiBase})`);
}

main().catch((err: unknown) => {
  stderrLogger.error(err instanceof Error ? err.message : 'failed to start');
  process.exit(1);
});
