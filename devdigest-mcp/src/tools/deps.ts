import type { DevDigestApi } from '../devdigest-api.js';
import type { McpConfig } from '../config.js';
import type { Logger } from '../logger.js';

/** Everything a tool handler needs; injected so tests use fakes (no real HTTP, no real clock). */
export interface ToolDeps {
  api: DevDigestApi;
  config: McpConfig;
  logger: Logger;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
