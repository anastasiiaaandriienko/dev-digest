import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, TOOL_NAMES } from '../src/server.js';
import { AGENT, PR, REPO, RUN, finding, makeDeps, review, type Handler } from './helpers.js';

const handler: Handler = (c) => {
  if (c.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT, agent_name: 'A' }] } };
  if (c.path === '/agents') return { body: [{ id: AGENT, name: 'A', enabled: true, system_prompt: 'SECRET' }] };
  if (c.path.endsWith('/runs')) return { body: [{ run_id: RUN, agent_id: AGENT, status: 'done', duration_ms: 5 }] };
  if (c.path.endsWith('/reviews')) return { body: [review({ findings: [finding()] })] };
  if (c.path.startsWith('/pulls?')) {
    return {
      body: {
        matches: [{ id: PR, number: 3, title: 'T', status: 'open', repo_id: REPO, repo_full_name: 'o/r' }],
        truncated: false,
        repo_matches: c.path.includes('repo=') ? [{ id: REPO, full_name: 'o/r' }] : null,
      },
    };
  }
  if (c.path.endsWith('/blast')) {
    return {
      body: {
        changed_symbols: [{ name: 'f', file: 'a.ts', kind: 'function', line: 1, url: null }],
        downstream: [
          {
            symbol: 'f',
            file: 'a.ts',
            callers: [{ name: 'g', file: 'b.ts', line: 2, url: null }],
            caller_count: 1,
            truncated: false,
            endpoints_affected: ['GET /x'],
            crons_affected: [],
          },
        ],
        summary: '1 changed symbol, 1 caller; potentially affected: 1 endpoint.',
        totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
        degraded: false,
        reason: null,
        source: { repo_full_name: 'o/r', ref: 'abc1234' },
      },
    };
  }
  if (c.path.startsWith('/repos/')) {
    return {
      body: {
        scan: null,
        candidates: [{ id: 'c1', rule: 'r', category: 'k', status: 'accepted' }],
        counts: { pending: 0, accepted: 1, rejected: 0 },
        source: { repo_full_name: 'o/r', ref: 'main' },
      },
    };
  }
  return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
};

let client: Client | undefined;

async function connect(h: Handler = handler) {
  const { deps } = makeDeps(h);
  const server = createServer(deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(ct);
  return client;
}

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('progress notifications', () => {
  it('run_agent_on_pr sends notifications/progress to a client that asked for them', async () => {
    let polls = 0;
    const c = await connect((call) => {
      if (call.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT }] } };
      if (call.path.endsWith('/runs')) {
        polls++;
        return { body: [{ run_id: RUN, agent_id: AGENT, status: polls < 3 ? 'running' : 'done' }] };
      }
      if (call.path.endsWith('/reviews')) return { body: [review({ findings: [] })] };
      return { status: 404 };
    });
    const seen: Array<{ progress: number; total?: number }> = [];
    const res = await c.callTool({ name: 'run_agent_on_pr', arguments: { pr_id: PR, agent_id: AGENT } }, undefined, {
      onprogress: (p) => seen.push({ progress: p.progress, total: p.total }),
    });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { status: string }).status).toBe('done');
    expect(seen.length).toBe(2);
    expect(seen.every((p) => typeof p.total === 'number' && p.progress <= p.total!)).toBe(true);
  });
});

describe('MCP protocol surface', () => {
  it('exposes exactly the five tools', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
    );
    expect([...TOOL_NAMES]).toEqual(['list_agents', 'run_agent_on_pr', 'get_findings', 'get_conventions', 'get_blast_radius']);
  });

  it('lists tools by name (no title) with only the read-only badge; run_agent_on_pr is not read-only', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.title, t.name).toBeUndefined();
      if (t.name === 'run_agent_on_pr') {
        // Explicit false hints render no badge; openWorldHint stays at its MCP default (true).
        expect(t.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
      } else {
        expect(t.annotations, t.name).toEqual({ readOnlyHint: true });
      }
    }
  });

  it.each([
    ['list_agents', {}],
    ['run_agent_on_pr', { pr_id: PR, agent_id: AGENT }],
    ['get_findings', { pr_id: PR }],
    ['get_conventions', { repo_id: REPO }],
    ['get_blast_radius', { pr_id: PR }],
  ])('%s returns text plus schema-valid structuredContent', async (name, args) => {
    const c = await connect();
    // callTool validates structuredContent against outputSchema and throws on mismatch.
    const res = await c.callTool({ name, arguments: args });
    expect(res.isError).toBeFalsy();
    const content = res.content as { type: string; text: string }[];
    expect(content[0]).toMatchObject({ type: 'text' });
    expect(content[0]!.text.length).toBeGreaterThan(0);
    expect(res.structuredContent).toBeTypeOf('object');
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });

  it('list_agents applies the enabled_only default through the schema', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'list_agents', arguments: {} });
    expect((res.structuredContent as { count: number }).count).toBe(1);
  });

  it('API errors become isError results without stacks or secrets', async () => {
    const c = await connect(() => ({
      status: 500,
      body: { error: { code: 'BOOM', message: 'failed with ghp_abcdef123456 and sk-abcdefgh12345 and Bearer tok.en' } },
    }));
    for (const [name, args] of [
      ['list_agents', {}],
      ['run_agent_on_pr', { pr_id: PR, agent_id: AGENT }],
      ['get_findings', { pr_id: PR }],
      ['get_conventions', { repo_id: REPO }],
      ['get_blast_radius', { pr_id: PR }],
    ] as const) {
      const res = await c.callTool({ name, arguments: args });
      expect(res.isError, name).toBe(true);
      const text = JSON.stringify(res);
      expect(text).not.toMatch(/\n\s+at /);
      expect(text).not.toMatch(/\\n\s+at /);
      expect(text).not.toMatch(/ghp_|sk-[A-Za-z0-9]{8}|tok\.en/);
    }
  });

  /** Input schema of a tool: property names in order, required list, additionalProperties. */
  async function inputOf(name: string) {
    const c = await connect();
    const { tools } = await c.listTools();
    return tools.find((t) => t.name === name)!.inputSchema as {
      properties: Record<string, { type?: string; default?: unknown; description?: string }>;
      required?: string[];
      additionalProperties?: boolean;
    };
  }

  it('get_findings has exactly pr_id*, repo, all_runs (boolean, default false) in this order', async () => {
    const s = await inputOf('get_findings');
    expect(Object.keys(s.properties)).toEqual(['pr_id', 'repo', 'all_runs']);
    expect(s.required).toEqual(['pr_id']);
    expect(s.properties.pr_id!.type).toBe('string');
    expect(s.properties.repo!.type).toBe('string');
    expect(s.properties.all_runs).toMatchObject({ type: 'boolean', default: false });
    expect(s.additionalProperties).toBe(false);
  });

  it('get_blast_radius has exactly pr_id*, repo; run_agent_on_pr has exactly pr_id*, repo, agent_id*', async () => {
    const blast = await inputOf('get_blast_radius');
    expect(Object.keys(blast.properties)).toEqual(['pr_id', 'repo']);
    expect(blast.required).toEqual(['pr_id']);
    const run = await inputOf('run_agent_on_pr');
    expect(Object.keys(run.properties)).toEqual(['pr_id', 'repo', 'agent_id']);
    expect(run.required).toEqual(['pr_id', 'agent_id']);
  });

  it('legacy fields (pr_number, run_id, agent_id, timeout_seconds) are rejected, not silently ignored', async () => {
    const c = await connect();
    for (const [name, args] of [
      ['get_findings', { pr_id: PR, run_id: RUN }],
      ['get_findings', { pr_id: PR, agent_id: AGENT }],
      ['get_blast_radius', { pr_id: PR, pr_number: 3 }],
      ['run_agent_on_pr', { pr_id: PR, agent_id: AGENT, timeout_seconds: 60 }],
    ] as const) {
      const res = await c.callTool({ name, arguments: args }).catch((e: Error) => e);
      if (res instanceof Error) expect(res.message, name).toMatch(/unrecognized|Invalid/i);
      else expect(res.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
  });

  it('pr_id sent as a JSON number (18 instead of "18") is accepted as a PR number', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'get_blast_radius', arguments: { pr_id: 3, repo: 'o/r' } });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { pr_id: string }).pr_id).toBe(PR);
  });

  it('get_blast_radius and get_findings by "#3" + repo return schema-valid structuredContent', async () => {
    const c = await connect();
    for (const name of ['get_blast_radius', 'get_findings']) {
      // callTool validates structuredContent against outputSchema and throws on mismatch.
      const res = await c.callTool({ name, arguments: { pr_id: '#3', repo: 'o/r' } });
      expect(res.isError, name).toBeFalsy();
      expect((res.structuredContent as { pr_id: string }).pr_id).toBe(PR);
      expect((res.content as { text: string }[])[0]!.text).toContain('Resolved PR #3 in o/r');
    }
  });

  it('no nullable output field uses a type array (schema portability)', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    expect(JSON.stringify(tools)).not.toMatch(/"type":\[/);
  });

  it('invalid input (missing / 1-character pr_id) is an isError result, not a crash', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'get_findings', arguments: { pr_id: 'x' } }).catch((e) => e);
    if (res instanceof Error) {
      expect(res.message).not.toMatch(/\n\s+at /);
    } else {
      expect(res.isError).toBe(true);
    }
  });
});
