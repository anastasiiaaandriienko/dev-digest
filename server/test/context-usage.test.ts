import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextUsage } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { ContextService } from '../src/modules/context/service.js';
import type { ContextOwnerKind } from '../src/modules/context/types.js';
import { InMemoryContextStore } from './helpers/context-store.js';

/** GET /repos/:id/context/usage (amendment A2): counting rules over the in-memory store. */
const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const WS = 'w1';
const OTHER_WS = 'w2';
const REPO = '11111111-1111-4111-8111-111111111111';
const OTHER_REPO = '22222222-2222-4222-8222-222222222222';
const FOREIGN_REPO = '55555555-5555-4555-8555-555555555555';
const NO_CLONE_REPO = '44444444-4444-4444-8444-444444444444';

let store: InMemoryContextStore;
let app: FastifyInstance;

const url = (repo = REPO) => `/repos/${repo}/context/usage`;

async function attach(
  owner: ContextOwnerKind,
  ownerId: string,
  path: string,
  opts: { workspaceId?: string; repoId?: string } = {},
): Promise<void> {
  await store.insertAttachment({
    workspaceId: opts.workspaceId ?? WS,
    owner,
    ownerId,
    repoId: opts.repoId ?? REPO,
    path,
  });
}

async function items(repo = REPO): Promise<{ path: string; agent_count: number }[]> {
  const res = await app.inject({ method: 'GET', url: url(repo) });
  expect(res.statusCode).toBe(200);
  return res.json().items;
}

beforeEach(async () => {
  store = new InMemoryContextStore();
  store.addRepo(WS, REPO, null);
  store.addRepo(WS, OTHER_REPO, null);
  store.addRepo(WS, NO_CLONE_REPO, null);
  store.addRepo(OTHER_WS, FOREIGN_REPO, null);
  app = await buildApp({
    config,
    db: {} as Db,
    overrides: { auth: new MockAuthProvider(), contextStore: store },
  });
});

afterEach(async () => {
  await app.close();
});

describe('context usage', () => {
  it('AC-CTX-127 returns 200 ContextUsage sorted by path (UTF-16)', async () => {
    store.addAgent(WS, 'a1');
    for (const p of ['docs/b.md', 'docs/a.md', 'Docs/a.md', 'docs/B.md']) await attach('agent', 'a1', p);
    const res = await app.inject({ method: 'GET', url: url() });
    expect(res.statusCode).toBe(200);
    const body = ContextUsage.parse(res.json());
    expect(body.repo_id).toBe(REPO);
    expect(body.items.map((i) => i.path)).toEqual(['Docs/a.md', 'docs/B.md', 'docs/a.md', 'docs/b.md']);
    expect(body.items.every((i) => i.agent_count === 1)).toBe(true);
  });

  it('AC-CTX-128 an agent attached directly and via skills counts once', async () => {
    store.addAgent(WS, 'a1');
    store.addSkill(WS, 's1');
    store.addSkill(WS, 's2');
    store.linkSkill('a1', 's1');
    store.linkSkill('a1', 's2');
    await attach('agent', 'a1', 'docs/p.md');
    await attach('skill', 's1', 'docs/p.md');
    await attach('skill', 's2', 'docs/p.md');
    expect(await items()).toEqual([{ path: 'docs/p.md', agent_count: 1 }]);
  });

  it('AC-CTX-129 skill link counts only when agent_skills.enabled and skills.enabled', async () => {
    store.addAgent(WS, 'a-ok');
    store.addAgent(WS, 'a-link-off');
    store.addAgent(WS, 'a-skill-off');
    store.addSkill(WS, 's-on');
    store.addSkill(WS, 's-off', false);
    store.linkSkill('a-ok', 's-on', true);
    store.linkSkill('a-link-off', 's-on', false);
    store.linkSkill('a-skill-off', 's-off', true);
    await attach('skill', 's-on', 'docs/p.md');
    await attach('skill', 's-off', 'docs/q.md');
    expect(await items()).toEqual([{ path: 'docs/p.md', agent_count: 1 }]);
  });

  it('AC-CTX-130 disabled agents are counted', async () => {
    store.addAgent(WS, 'a-on');
    store.addAgent(WS, 'a-off', false);
    store.addSkill(WS, 's1');
    store.linkSkill('a-off', 's1');
    await attach('agent', 'a-on', 'docs/p.md');
    await attach('agent', 'a-off', 'docs/p.md');
    await attach('skill', 's1', 'docs/q.md');
    expect(await items()).toEqual([
      { path: 'docs/p.md', agent_count: 2 },
      { path: 'docs/q.md', agent_count: 1 },
    ]);
  });

  it('AC-CTX-131 other repo and other workspace rows are not counted', async () => {
    store.addAgent(WS, 'a1');
    store.addAgent(WS, 'a2');
    store.addAgent(OTHER_WS, 'x1');
    store.addSkill(OTHER_WS, 'xs');
    store.addSkill(WS, 's1');
    store.linkSkill('a2', 'xs'); // a W1 agent linked to a W2 skill
    store.linkSkill('x1', 's1'); // a W2 agent linked to a W1 skill
    await attach('agent', 'a1', 'docs/p.md');
    await attach('agent', 'a2', 'docs/p.md', { repoId: OTHER_REPO });
    await attach('agent', 'x1', 'docs/p.md', { workspaceId: OTHER_WS, repoId: FOREIGN_REPO });
    await attach('skill', 'xs', 'docs/p.md', { workspaceId: OTHER_WS, repoId: FOREIGN_REPO });
    await attach('skill', 's1', 'docs/p.md');
    expect(await items()).toEqual([{ path: 'docs/p.md', agent_count: 1 }]);
    expect(await items(OTHER_REPO)).toEqual([{ path: 'docs/p.md', agent_count: 1 }]);
  });

  it('AC-CTX-132 unknown or foreign repo → 404, no usageByPath call', async () => {
    for (const id of ['99999999-9999-4999-8999-999999999999', FOREIGN_REPO]) {
      const res = await app.inject({ method: 'GET', url: url(id) });
      expect(res.statusCode).toBe(404);
    }
    expect(store.usageCalls).toBe(0);
  });

  it('AC-CTX-133 non-uuid id → 422', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/context/usage' });
    expect(res.statusCode).toBe(422);
    expect(store.usageCalls).toBe(0);
  });

  it('AC-CTX-134 uncloned repo → 200, walk/readDoc spies not called', async () => {
    store.addAgent(WS, 'a1');
    await attach('agent', 'a1', 'docs/p.md', { repoId: NO_CLONE_REPO });
    const readDoc = vi.fn();
    const walk = vi.fn();
    const service = new ContextService({ contextStore: store } as unknown as Container, { readDoc, walk });
    await expect(service.usage(WS, NO_CLONE_REPO)).resolves.toEqual({
      repo_id: NO_CLONE_REPO,
      items: [{ path: 'docs/p.md', agent_count: 1 }],
    });
    expect(readDoc).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
    const res = await app.inject({ method: 'GET', url: url(NO_CLONE_REPO) });
    expect(res.statusCode).toBe(200);
  });

  it('AC-CTX-135 missing/outside_roots paths still counted', async () => {
    store.addAgent(WS, 'a1');
    store.setRoots(WS, REPO, ['docs']);
    await attach('agent', 'a1', 'gone/missing.md');
    await attach('agent', 'a1', 'notes/outside.md');
    expect(await items()).toEqual([
      { path: 'gone/missing.md', agent_count: 1 },
      { path: 'notes/outside.md', agent_count: 1 },
    ]);
  });

  it('AC-CTX-136 discovered but unused docs are absent from items', async () => {
    store.addAgent(WS, 'a1');
    store.addSkill(WS, 's-unlinked');
    await attach('skill', 's-unlinked', 'docs/unused.md'); // skill without a link: nobody uses it
    await attach('agent', 'a1', 'docs/used.md');
    expect((await items()).map((i) => i.path)).toEqual(['docs/used.md']);
  });

  it('AC-CTX-139 no writes (inserts/rootsSaves/rows unchanged) and no LLM access', async () => {
    store.addAgent(WS, 'a1');
    await attach('agent', 'a1', 'docs/p.md');
    const before = { inserts: store.inserts.length, saves: store.rootsSaves, rows: JSON.stringify(store.rows) };
    await items();
    expect(store.inserts).toHaveLength(before.inserts);
    expect(store.rootsSaves).toBe(before.saves);
    expect(JSON.stringify(store.rows)).toBe(before.rows);
    // The service works with a container that holds only the context store: no LLM adapter is reachable.
    const service = new ContextService({ contextStore: store } as unknown as Container);
    await expect(service.usage(WS, REPO)).resolves.toMatchObject({ repo_id: REPO });
  });
});
