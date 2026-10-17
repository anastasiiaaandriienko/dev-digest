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

  it('annotates read-only tools and flags run_agent_on_pr as paid and open-world', async () => {
    const c = await connect();
    const { tools } = await c.listTools();
    for (const t of tools) {
      expect(t.outputSchema, t.name).toBeDefined();
      if (t.name === 'run_agent_on_pr') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
        expect(t.description).toContain('PAID');
      } else {
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
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
    ] as const) {
      const res = await c.callTool({ name, arguments: args });
      expect(res.isError, name).toBe(true);
      const text = JSON.stringify(res);
      expect(text).not.toMatch(/\n\s+at /);
      expect(text).not.toMatch(/\\n\s+at /);
      expect(text).not.toMatch(/ghp_|sk-[A-Za-z0-9]{8}|tok\.en/);
    }
  });

  it('invalid input (non-uuid) is an isError result, not a crash', async () => {
    const c = await connect();
    const res = await c.callTool({ name: 'get_findings', arguments: { pr_id: 'not-a-uuid' } }).catch((e) => e);
    if (res instanceof Error) {
      expect(res.message).not.toMatch(/\n\s+at /);
    } else {
      expect(res.isError).toBe(true);
    }
  });
});
