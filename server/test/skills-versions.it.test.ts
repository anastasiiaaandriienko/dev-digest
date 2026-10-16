import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Skill, SkillRestoreResult, SkillVersion } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * HW2 #27–#29 (backend) — skill version history and restore over HTTP against a
 * real Postgres (Testcontainers): ordering and response schemas, restore as a
 * NEW version that keeps history and metadata, no-op restores, concurrency,
 * workspace isolation and 404 / 422. External adapters are mocked.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const MISSING = '00000000-0000-4000-8000-000000000000';

d('Skill versions + restore (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let otherWorkspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
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

  /** A skill whose bodies are `# v1` … `# v<n>` (versions 1..n). */
  async function skillWithVersions(n: number): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: `versioned-${seq++}`, type: 'rubric', description: 'd', body: '# v1' },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as Skill).id;
    for (let v = 2; v <= n; v++) {
      const put = await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: `# v${v}` } });
      expect(put.json().version).toBe(v);
    }
    return id;
  }

  const versions = async (id: string) => {
    const res = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(res.statusCode).toBe(200);
    return SkillVersion.array().parse(res.json());
  };
  const restore = (id: string, version: number | string) =>
    app.inject({ method: 'POST', url: `/skills/${id}/versions/${version}/restore` });
  const dbVersions = (id: string) =>
    db().select().from(t.skillVersions).where(eq(t.skillVersions.skillId, id)).orderBy(asc(t.skillVersions.version));

  it('V1: GET versions — newest first, schema-valid, only the live version is current', async () => {
    const id = await skillWithVersions(3);
    const list = await versions(id);
    expect(list.map((v) => [v.version, v.body, v.current])).toEqual([
      [3, '# v3', true],
      [2, '# v2', false],
      [1, '# v1', false],
    ]);
    expect(list.every((v) => v.skill_id === id && !Number.isNaN(Date.parse(v.created_at)))).toBe(true);
  });

  it('V2: restore copies the old body into a NEW version; history and metadata are kept', async () => {
    const id = await skillWithVersions(3);
    await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'renamed', description: 'kept', type: 'security', enabled: false, evidence_files: ['a.ts'] },
    });

    const res = await restore(id, 1);
    expect(res.statusCode).toBe(200);
    const result = SkillRestoreResult.parse(res.json());
    expect(result).toMatchObject({ restored: true, restored_from: 1 });
    expect(result.skill).toMatchObject({
      body: '# v1',
      version: 4,
      name: 'renamed',
      description: 'kept',
      type: 'security',
      enabled: false,
      evidence_files: ['a.ts'],
    });

    expect((await dbVersions(id)).map((v) => [v.version, v.body])).toEqual([
      [1, '# v1'],
      [2, '# v2'],
      [3, '# v3'],
      [4, '# v1'],
    ]);
    const list = await versions(id);
    expect(list[0]).toMatchObject({ version: 4, body: '# v1', current: true });
    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, id));
    expect(row).toMatchObject({ version: 4, body: '# v1', name: 'renamed', enabled: false, type: 'security' });
  });

  it('V3: restoring a body that is already current is a no-op (no duplicate version)', async () => {
    const id = await skillWithVersions(2);
    const current = SkillRestoreResult.parse((await restore(id, 2)).json());
    expect(current).toMatchObject({ restored: false, restored_from: 2, skill: { version: 2, body: '# v2' } });

    // An older version whose body equals the current one is also a no-op.
    await restore(id, 1); // v3 = '# v1'
    const same = SkillRestoreResult.parse((await restore(id, 1)).json());
    expect(same).toMatchObject({ restored: false, skill: { version: 3, body: '# v1' } });
    expect((await dbVersions(id)).map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('V4: concurrent restores and edits each get a distinct next version (row lock)', async () => {
    const id = await skillWithVersions(3);
    const results = await Promise.all([
      restore(id, 1),
      restore(id, 2),
      app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# edit' } }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);

    const rows = await dbVersions(id);
    const numbers = rows.map((v) => v.version);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.slice(0, 3)).toEqual([1, 2, 3]);
    expect(rows.length).toBeGreaterThanOrEqual(5); // no lost writes (a restore may become a no-op)
    const [skill] = await db().select().from(t.skills).where(eq(t.skills.id, id));
    expect(skill!.version).toBe(numbers[numbers.length - 1]);
    expect(skill!.body).toBe(rows[rows.length - 1]!.body);
  });

  it('V5: another workspace’s skill — versions and restore are 404 and nothing is written', async () => {
    const [foreign] = await db()
      .insert(t.skills)
      .values({ workspaceId: otherWorkspaceId, name: 'foreign', description: '', type: 'custom', source: 'manual', body: '# x' })
      .returning();
    await db().insert(t.skillVersions).values({ skillId: foreign!.id, version: 1, body: '# x' });

    expect((await app.inject({ method: 'GET', url: `/skills/${foreign!.id}/versions` })).statusCode).toBe(404);
    expect((await restore(foreign!.id, 1)).statusCode).toBe(404);
    const [row] = await db()
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.id, foreign!.id), eq(t.skills.workspaceId, otherWorkspaceId)));
    expect(row).toMatchObject({ version: 1, body: '# x' });
    expect(await dbVersions(foreign!.id)).toHaveLength(1);
  });

  it('V6: 404 for an unknown skill or version; 422 for a bad id or version', async () => {
    const id = await skillWithVersions(1);
    expect((await app.inject({ method: 'GET', url: `/skills/${MISSING}/versions` })).statusCode).toBe(404);
    expect((await restore(MISSING, 1)).statusCode).toBe(404);
    const unknown = await restore(id, 9);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.message).toContain('version 9');

    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid/versions' })).statusCode).toBe(422);
    expect((await restore(id, 0)).statusCode).toBe(422);
    expect((await restore(id, 'abc')).statusCode).toBe(422);
    expect((await restore('not-a-uuid', 1)).statusCode).toBe(422);
    expect(await dbVersions(id)).toHaveLength(1);
  });

  it('V7: deleting a skill removes its versions and agent links but keeps the agents', async () => {
    const id = await skillWithVersions(2);
    const [ws] = await db().select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    const [agent] = await db()
      .insert(t.agents)
      .values({ workspaceId: ws!.id, name: `keeper-${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p' })
      .returning();
    await db().insert(t.agentSkills).values({ agentId: agent!.id, skillId: id, order: 0 });

    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(200);
    expect(await dbVersions(id)).toHaveLength(0);
    expect(await db().select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agent!.id))).toHaveLength(0);
    expect(await db().select().from(t.agents).where(eq(t.agents.id, agent!.id))).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).statusCode).toBe(404);
  });
});
