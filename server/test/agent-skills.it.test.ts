import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AgentSkillLink } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { schema } from '../src/db/schema.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

/**
 * HW2 #13 (backend) — an agent's ordered skill list over HTTP against a real
 * Postgres: order + per-agent `enabled` (migration 0010), detach, workspace
 * ownership of every attached skill (422, nothing written), 404 for another
 * workspace's agent, the legacy POST, and concurrent replaces.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const MISSING = '00000000-0000-4000-8000-000000000000';

d('Agent skills (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let ws: string;
  let otherWs: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [w] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    ws = w!.id;
    const [o] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    otherWs = o!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: new MockSecretsProvider({}), github: new MockGitHubClient({ pulls: [] }) },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  async function agent(workspaceId = ws): Promise<string> {
    const [a] = await db()
      .insert(t.agents)
      .values({ workspaceId, name: `agent-${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
      .returning();
    return a!.id;
  }
  async function skill(workspaceId = ws): Promise<string> {
    const [s] = await db()
      .insert(t.skills)
      .values({ workspaceId, name: `skill-${seq++}`, description: '', type: 'custom', source: 'manual', body: '# x' })
      .returning();
    return s!.id;
  }
  const put = (agentId: string, skills: unknown) =>
    app.inject({ method: 'PUT', url: `/agents/${agentId}/skills`, payload: { skills } });
  const get = async (agentId: string) => {
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` });
    expect(res.statusCode).toBe(200);
    return AgentSkillLink.array().parse(res.json());
  };
  const rows = (agentId: string) =>
    db().select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agentId)).orderBy(asc(t.agentSkills.order));

  it('A1: PUT stores the list in array order with per-agent enabled; GET returns it', async () => {
    const a = await agent();
    const [s1, s2, s3] = [await skill(), await skill(), await skill()];
    const res = await put(a, [
      { skill_id: s2, enabled: true },
      { skill_id: s1, enabled: false },
      { skill_id: s3 }, // enabled defaults to true
    ]);
    expect(res.statusCode).toBe(200);
    const expected = [
      { agent_id: a, skill_id: s2, order: 0, enabled: true },
      { agent_id: a, skill_id: s1, order: 1, enabled: false },
      { agent_id: a, skill_id: s3, order: 2, enabled: true },
    ];
    expect(AgentSkillLink.array().parse(res.json())).toEqual(expected);
    expect(await get(a)).toEqual(expected);
    expect((await rows(a)).map((r) => [r.skillId, r.order, r.enabled])).toEqual([
      [s2, 0, true],
      [s1, 1, false],
      [s3, 2, true],
    ]);
  });

  it('A2: a later PUT reorders and detaches what it omits; [] detaches all (skills themselves stay)', async () => {
    const a = await agent();
    const [s1, s2] = [await skill(), await skill()];
    await put(a, [{ skill_id: s1 }, { skill_id: s2 }]);
    await put(a, [{ skill_id: s2, enabled: false }]);
    expect((await get(a)).map((l) => [l.skill_id, l.order, l.enabled])).toEqual([[s2, 0, false]]);
    expect((await put(a, [])).statusCode).toBe(200);
    expect(await get(a)).toEqual([]);
    expect(await db().select().from(t.skills).where(eq(t.skills.id, s1))).toHaveLength(1);
  });

  it('A3: a skill from another workspace or unknown → 422 and the previous list is untouched', async () => {
    const a = await agent();
    const mine = await skill();
    const foreign = await skill(otherWs);
    await put(a, [{ skill_id: mine, enabled: false }]);

    const bad = await put(a, [{ skill_id: mine }, { skill_id: foreign }, { skill_id: MISSING }]);
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details.skill_ids.sort()).toEqual([foreign, MISSING].sort());
    expect((await rows(a)).map((r) => [r.skillId, r.enabled])).toEqual([[mine, false]]);
  });

  it('A4: validation — duplicates, bad uuids and a missing body are 422', async () => {
    const a = await agent();
    const s = await skill();
    expect((await put(a, [{ skill_id: s }, { skill_id: s }])).statusCode).toBe(422);
    expect((await put(a, [{ skill_id: 'nope' }])).statusCode).toBe(422);
    expect((await app.inject({ method: 'PUT', url: `/agents/${a}/skills`, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PUT', url: `/agents/not-a-uuid/skills`, payload: { skills: [] } })).statusCode).toBe(422);
  });

  it('A5: another workspace’s agent → 404 and its links are untouched', async () => {
    const foreignAgent = await agent(otherWs);
    const foreignSkill = await skill(otherWs);
    await db().insert(t.agentSkills).values({ agentId: foreignAgent, skillId: foreignSkill, order: 0 });
    expect((await put(foreignAgent, [])).statusCode).toBe(404);
    expect((await put(MISSING, [])).statusCode).toBe(404);
    expect(await rows(foreignAgent)).toHaveLength(1);
  });

  it('A6: legacy POST — skill_ids are workspace-checked and keep existing enabled flags; skill_id too', async () => {
    const a = await agent();
    const [s1, s2] = [await skill(), await skill()];
    const foreign = await skill(otherWs);
    await put(a, [{ skill_id: s1, enabled: false }]);

    const reorder = await app.inject({ method: 'POST', url: `/agents/${a}/skills`, payload: { skill_ids: [s2, s1] } });
    expect(reorder.statusCode).toBe(200);
    expect((await get(a)).map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [s2, 0, true],
      [s1, 1, false],
    ]);
    const badSet = await app.inject({ method: 'POST', url: `/agents/${a}/skills`, payload: { skill_ids: [foreign] } });
    expect(badSet.statusCode).toBe(422);
    const badOne = await app.inject({ method: 'POST', url: `/agents/${a}/skills`, payload: { skill_id: foreign } });
    expect(badOne.statusCode).toBe(422);
    expect(await rows(a)).toHaveLength(2);
  });

  it('A7: concurrent PUTs serialize: the result is exactly one of the requested lists', async () => {
    const a = await agent();
    const ids = [await skill(), await skill(), await skill()];
    const lists = [
      [ids[0]!, ids[1]!],
      [ids[2]!],
      [ids[1]!, ids[2]!, ids[0]!],
    ];
    const results = await Promise.all(lists.map((l) => put(a, l.map((skill_id) => ({ skill_id })))));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    const final = (await rows(a)).map((r) => r.skillId);
    expect(lists.map((l) => l.join(','))).toContain(final.join(','));
    expect((await rows(a)).map((r) => r.order)).toEqual(final.map((_, i) => i));
  });

  it('A-count (HW2 #32): GET /agents returns skill_count = attached skills, enabled or not, workspace-scoped', async () => {
    const withSkills = await agent();
    const without = await agent();
    const [s1, s2, s3] = [await skill(), await skill(), await skill()];
    expect((await put(withSkills, [
      { skill_id: s1, enabled: true },
      { skill_id: s2, enabled: false }, // disabled for this agent: still attached
      { skill_id: s3, enabled: true },
    ])).statusCode).toBe(200);
    await db().update(t.skills).set({ enabled: false }).where(eq(t.skills.id, s3)); // disabled globally: still attached

    // A foreign-workspace agent with links must not leak into this list.
    const foreign = await agent(otherWs);
    await db().insert(t.agentSkills).values({ agentId: foreign, skillId: await skill(otherWs), order: 0 });

    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as { id: string; skill_count?: number }[];
    const byId = new Map(list.map((a) => [a.id, a.skill_count]));
    expect(byId.get(withSkills)).toBe(3);
    expect(byId.get(without)).toBe(0);
    expect(byId.has(foreign)).toBe(false);
    expect(list.every((a) => typeof a.skill_count === 'number')).toBe(true);

    // ONE statement for the whole list, however many agents (no N+1).
    const statements: string[] = [];
    const logged = drizzle(pg.handle.sql, { schema, logger: { logQuery: (q) => statements.push(q) } });
    const repo = new AgentsRepository(logged as unknown as typeof pg.handle.db);
    const counted = await repo.listWithSkillCount(ws);
    expect(counted.length).toBeGreaterThanOrEqual(2);
    expect(statements).toHaveLength(1);

    // Detaching updates the count.
    await put(withSkills, [{ skill_id: s1, enabled: true }]);
    const after = (await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string; skill_count: number }[];
    expect(after.find((a) => a.id === withSkills)!.skill_count).toBe(1);
  });
});
