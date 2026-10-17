import { ApiClient, type FetchLike } from '../src/api-client.js';
import { DevDigestApi } from '../src/devdigest-api.js';
import type { McpConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import type { ToolDeps } from '../src/tools/deps.js';

export const PR = '11111111-1111-4111-8111-111111111111';
export const AGENT = '22222222-2222-4222-8222-222222222222';
export const AGENT2 = '33333333-3333-4333-8333-333333333333';
export const RUN = '44444444-4444-4444-8444-444444444444';
export const REPO = '55555555-5555-4555-8555-555555555555';

export interface Reply {
  status?: number;
  body?: unknown;
  /** Raw text body (overrides body). */
  text?: string;
}
export interface Call {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
export type Handler = (call: Call) => Reply;

export function jsonResponse(reply: Reply): Response {
  const status = reply.status ?? 200;
  const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

export function makeFetch(handler: Handler): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init) => {
    const u = new URL(input);
    const call: Call = {
      method: init?.method ?? 'GET',
      url: input,
      path: u.pathname + u.search,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return jsonResponse(handler(call));
  };
  return { fetch, calls };
}

export const TEST_CONFIG: McpConfig = {
  apiBase: 'http://api.test',
  requestTimeoutMs: 1_000,
  runTimeoutMs: 30_000,
  pollIntervalMs: 3_000,
};

/** Deps over a fake fetch, a fake sleep and a clock that only moves when sleep is called. */
export function makeDeps(handler: Handler, config: Partial<McpConfig> = {}) {
  const { fetch, calls } = makeFetch(handler);
  const cfg = { ...TEST_CONFIG, ...config };
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const deps: ToolDeps = {
    api: new DevDigestApi(new ApiClient({ baseUrl: cfg.apiBase, timeoutMs: cfg.requestTimeoutMs, fetch })),
    config: cfg,
    logger: silentLogger,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, calls, sleeps };
}

export function finding(over: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'a.ts',
    start_line: 1,
    end_line: 2,
    ...over,
  };
}

export function review(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    pr_id: PR,
    agent_id: AGENT,
    run_id: RUN,
    agent_name: 'Bug hunter',
    kind: 'review',
    verdict: 'comment',
    summary: 'sum',
    score: 80,
    model: 'm',
    created_at: '2026-01-01T00:00:00Z',
    findings: [],
    ...over,
  };
}

export function textOf(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}
