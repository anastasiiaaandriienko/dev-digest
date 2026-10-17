/**
 * Runtime configuration from environment variables. Validated once at start-up;
 * invalid values fail fast with a message on stderr (never on stdout).
 */

export interface McpConfig {
  /** Base URL of the DevDigest Fastify API, without a trailing slash. */
  apiBase: string;
  /** Timeout of ONE HTTP request to the API. */
  requestTimeoutMs: number;
  /** Default time run_agent_on_pr waits for a review run to finish. */
  runTimeoutMs: number;
  /** Delay between two status polls of a running review. */
  pollIntervalMs: number;
}

export const DEFAULT_API_BASE = 'http://localhost:3001';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/**
 * Default wait of run_agent_on_pr: below the 60 s default request timeout of SDK-based MCP
 * clients (e.g. the Inspector). Longer waits need a client that resets its timeout on the
 * progress notifications this server sends, or a raised client timeout.
 */
export const DEFAULT_RUN_TIMEOUT_MS = 50_000;
export const DEFAULT_POLL_INTERVAL_MS = 3_000;
/** Upper bound for any wait. */
export const MAX_RUN_TIMEOUT_MS = 600_000;

function intFromEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const rawBase = (env.DEVDIGEST_API_BASE ?? DEFAULT_API_BASE).trim();
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new Error('DEVDIGEST_API_BASE must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DEVDIGEST_API_BASE must be an absolute http(s) URL');
  }
  if (url.username || url.password) {
    throw new Error('DEVDIGEST_API_BASE must not contain credentials');
  }
  return {
    apiBase: `${url.origin}${url.pathname}`.replace(/\/+$/, ''),
    requestTimeoutMs: intFromEnv(env, 'DEVDIGEST_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS, 1_000, 120_000),
    runTimeoutMs: intFromEnv(env, 'DEVDIGEST_RUN_TIMEOUT_MS', DEFAULT_RUN_TIMEOUT_MS, 10_000, MAX_RUN_TIMEOUT_MS),
    // ≥ 2 s: the API rate-limits 120 requests/min per IP, shared with the web app.
    pollIntervalMs: intFromEnv(env, 'DEVDIGEST_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS, 2_000, 60_000),
  };
}
