import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Skill } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * HW2 #8 — Skills CRUD over HTTP against a real Postgres (Testcontainers):
 * persistence (checked with direct SQL), workspace isolation, agent_count,
 * version 1 on create, a version only when the body changes, cascade on delete,
 * and 404 / 422. External adapters are mocked; nothing touches the dev DB.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const MISSING = '00000000-0000-4000-8000-000000000000';

d('Skills CRUD (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    otherWorkspaceId = other!.id;
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

  async function create(over: Record<string, unknown> = {}): Promise<Skill> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `skill-${seq++}`, type: 'rubric', body: '# Rule\nv1', description: 'd', ...over },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Skill;
  }

  async function newAgent(ws: string): Promise<string> {
    const [a] = await db()
      .insert(t.agents)
      .values({ workspaceId: ws, name: `agent-${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
      .returning();
    return a!.id;
  }

  const versionsOf = (skillId: string) =>
    db().select().from(t.skillVersions).where(eq(t.skillVersions.skillId, skillId)).orderBy(asc(t.skillVersions.version));

  it('S1: POST persists the skill (found by direct SQL) at version 1 with its first version row', async () => {
    const skill = await create({ name: 'breaking-change', type: 'security', body: '# Breaking\nNo removed fields.' });
    expect(skill).toMatchObject({ name: 'breaking-change', type: 'security', source: 'manual', enabled: true, version: 1, agent_count: 0 });

    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row).toMatchObject({ workspaceId, name: 'breaking-change', body: '# Breaking\nNo removed fields.', version: 1 });
    expect((await versionsOf(skill.id)).map((v) => [v.version, v.body])).toEqual([[1, '# Breaking\nNo removed fields.']]);
  });

  it('S2: GET /skills and GET /skills/:id return it; a row deleted directly in the DB disappears from GET', async () => {
    const skill = await create();
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json() as Skill[];
    expect(list.map((s) => s.id)).toContain(skill.id);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json()).toMatchObject({ id: skill.id });

    await db().delete(t.skills).where(eq(t.skills.id, skill.id));
    const after = (await app.inject({ method: 'GET', url: '/skills' })).json() as Skill[];
    expect(after.map((s) => s.id)).not.toContain(skill.id);
    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).statusCode).toBe(404);
  });

  it('S3: agent_count counts links to agents of the same workspace only', async () => {
    const skill = await create();
    const a1 = await newAgent(workspaceId);
    const a2 = await newAgent(workspaceId);
    const foreign = await newAgent(otherWorkspaceId);
    await db().insert(t.agentSkills).values([
      { agentId: a1, skillId: skill.id, order: 0 },
      { agentId: a2, skillId: skill.id, order: 1 },
      { agentId: foreign, skillId: skill.id, order: 0 },
    ]);

    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json().agent_count).toBe(2);
    const listed = ((await app.inject({ method: 'GET', url: '/skills' })).json() as Skill[]).find((s) => s.id === skill.id);
    expect(listed!.agent_count).toBe(2);
  });

  it('S4: metadata-only PUT keeps the version; a changed body bumps it and appends a version row', async () => {
    const skill = await create({ body: '# v1' });

    const meta = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { name: 'renamed', description: 'new', type: 'convention', enabled: false },
    });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toMatchObject({ name: 'renamed', description: 'new', type: 'convention', enabled: false, version: 1 });
    expect(await versionsOf(skill.id)).toHaveLength(1);

    const same = await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: '# v1' } });
    expect(same.json().version).toBe(1);
    expect(await versionsOf(skill.id)).toHaveLength(1);

    const changed = await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: '# v2' } });
    expect(changed.json()).toMatchObject({ body: '# v2', version: 2, name: 'renamed' });
    expect((await versionsOf(skill.id)).map((v) => [v.version, v.body])).toEqual([
      [1, '# v1'],
      [2, '# v2'],
    ]);
    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row).toMatchObject({ body: '# v2', version: 2 });
  });

  it('S5: concurrent body edits get distinct versions (row lock, no lost update)', async () => {
    const skill = await create({ body: '# base' });
    const results = await Promise.all(
      ['# a', '# b', '# c'].map((body) => app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body } })),
    );
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await versionsOf(skill.id)).map((v) => v.version)).toEqual([1, 2, 3, 4]);
    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row!.version).toBe(4);
  });

  it('S6: DELETE removes the skill, its versions and its agent links', async () => {
    const skill = await create();
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: '# v2' } });
    const agent = await newAgent(workspaceId);
    await db().insert(t.agentSkills).values({ agentId: agent, skillId: skill.id, order: 0 });

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await db().select().from(t.skills).where(eq(t.skills.id, skill.id))).toHaveLength(0);
    expect(await versionsOf(skill.id)).toHaveLength(0);
    expect(await db().select().from(t.agentSkills).where(eq(t.agentSkills.skillId, skill.id))).toHaveLength(0);
    expect(await db().select().from(t.agents).where(eq(t.agents.id, agent))).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` })).statusCode).toBe(404);
  });

  it('S7: another workspace’s skill is invisible and cannot be read, updated or deleted', async () => {
    const [foreign] = await db()
      .insert(t.skills)
      .values({ workspaceId: otherWorkspaceId, name: 'foreign', description: '', type: 'custom', source: 'manual', body: '# x' })
      .returning();
    const id = foreign!.id;

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json() as Skill[];
    expect(list.map((s) => s.id)).not.toContain(id);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# hacked' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(404);

    const [still] = await db().select().from(t.skills).where(and(eq(t.skills.id, id), eq(t.skills.workspaceId, otherWorkspaceId)));
    expect(still).toMatchObject({ body: '# x', version: 1 });
  });

  it('S8: 404 for an unknown id; 422 for a bad id or an invalid body', async () => {
    expect((await app.inject({ method: 'GET', url: `/skills/${MISSING}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/skills/${MISSING}`, payload: { name: 'x' } })).statusCode).toBe(404);

    const badId = await app.inject({ method: 'GET', url: '/skills/not-a-uuid' });
    expect(badId.statusCode).toBe(422);
    expect(badId.json().error).toBeDefined();

    const noName = await app.inject({ method: 'POST', url: '/skills', payload: { type: 'custom', body: '# x' } });
    expect(noName.statusCode).toBe(422);
    const badType = await app.inject({ method: 'POST', url: '/skills', payload: { name: 'x', type: 'nope', body: '# x' } });
    expect(badType.statusCode).toBe(422);

    const skill = await create();
    expect((await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { body: '' } })).statusCode).toBe(422);
  });

  it('a client creates only manual skills, and executable content is refused on create and update', async () => {
    const asImport = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'fake-import', type: 'rubric', body: '# x', source: 'imported' },
    });
    expect(asImport.statusCode).toBe(422);

    const script = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'scripted', type: 'rubric', body: '# x\n<script>alert(1)</script>' },
    });
    expect(script.statusCode).toBe(422);

    const skill = await create();
    const put = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# x\n<img src=x onerror=alert(1)>' },
    });
    expect(put.statusCode).toBe(422);
    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(row!.body).toBe('# Rule\nv1'); // unchanged
    expect(row!.version).toBe(1);
  });
});
