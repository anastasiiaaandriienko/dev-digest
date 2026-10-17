import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  TEST_QUALITY_AGENT_NAME,
  TEST_QUALITY_AGENT_PROMPT,
  loadTestQualitySkill,
  seedTestQualityReviewer,
} from '../src/db/seed-test-quality.js';

/**
 * HW2 — Test Quality Reviewer setup against a real (throwaway) Postgres:
 * one skill + one agent + one link however often it runs, import semantics
 * (disabled unless asked, case-insensitive name), and user changes preserved.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('seedTestQualityReviewer (Testcontainers pg)', () => {
  let pg: PgFixture;
  let ws: string;
  let userId: string;

  beforeAll(async () => {
    pg = await startPg();
    const r = await seed(pg.handle.db);
    ws = r.workspaceId;
    userId = r.userId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;
  const count = async (workspaceId: string) => {
    const skills = await db().select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
    const agents = await db()
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, TEST_QUALITY_AGENT_NAME)));
    const links = agents[0]
      ? await db().select().from(t.agentSkills).where(eq(t.agentSkills.agentId, agents[0].id))
      : [];
    return { skills, agents, links };
  };

  it('S1: first run creates skill (disabled, v1), agent (v1 snapshot) and one enabled link', async () => {
    const r = await seedTestQualityReviewer(db(), { workspaceId: ws, userId });
    expect(r).toMatchObject({ skillCreated: true, agentCreated: true, linkCreated: true, skillBodyMatchesFile: true });
    expect(r.skillEnabled).toBe(false);
    expect(r.linkEnabled).toBe(true);

    const { skills, agents, links } = await count(ws);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'test-quality', type: 'rubric', source: 'imported', enabled: false, version: 1 });
    expect(skills[0]!.body).toBe(loadTestQualitySkill().body);
    expect(await db().select().from(t.skillVersions).where(eq(t.skillVersions.skillId, r.skillId))).toHaveLength(1);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      systemPrompt: TEST_QUALITY_AGENT_PROMPT,
      strategy: 'single-pass',
      version: 1,
      createdBy: userId,
    });
    expect(await db().select().from(t.agentVersions).where(eq(t.agentVersions.agentId, r.agentId))).toHaveLength(1);
    expect(links).toEqual([{ agentId: r.agentId, skillId: r.skillId, order: 0, enabled: true }]);
  });

  it('S2: re-running creates nothing new and returns the same ids', async () => {
    const before = await count(ws);
    const r = await seedTestQualityReviewer(db(), { workspaceId: ws, userId });
    expect(r).toMatchObject({ skillCreated: false, agentCreated: false, linkCreated: false });
    expect(r.skillId).toBe(before.skills[0]!.id);
    expect(r.agentId).toBe(before.agents[0]!.id);
    const after = await count(ws);
    expect(after.skills).toHaveLength(1);
    expect(after.agents).toHaveLength(1);
    expect(after.links).toHaveLength(1);
  });

  it('S3: user changes survive a re-run (link disabled, body edited, model switched)', async () => {
    const { skills, agents } = await count(ws);
    await db().update(t.agentSkills).set({ enabled: false }).where(eq(t.agentSkills.agentId, agents[0]!.id));
    await db().update(t.skills).set({ body: '# edited by user' }).where(eq(t.skills.id, skills[0]!.id));
    await db().update(t.agents).set({ model: 'other/model' }).where(eq(t.agents.id, agents[0]!.id));

    const r = await seedTestQualityReviewer(db(), { workspaceId: ws, userId });
    expect(r).toMatchObject({ linkCreated: false, linkEnabled: false, skillBodyMatchesFile: false });
    const after = await count(ws);
    expect(after.links[0]!.enabled).toBe(false);
    expect(after.skills[0]!.body).toBe('# edited by user');
    expect(after.agents[0]!.model).toBe('other/model');
  });

  it('S4: enableSkill turns the global skill switch on, still without duplicates', async () => {
    const r = await seedTestQualityReviewer(db(), { workspaceId: ws, userId, enableSkill: true });
    expect(r.skillEnabled).toBe(true);
    const { skills } = await count(ws);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.enabled).toBe(true);
  });

  it('S5: an existing skill with a different-case name is reused, not duplicated', async () => {
    const [o] = await db().insert(t.workspaces).values({ name: 'tq-case' }).returning();
    await db()
      .insert(t.skills)
      .values({ workspaceId: o!.id, name: 'Test-Quality', description: 'x', type: 'rubric', source: 'manual', body: '# mine' });
    const r = await seedTestQualityReviewer(db(), { workspaceId: o!.id });
    expect(r.skillCreated).toBe(false);
    const { skills, links } = await count(o!.id);
    expect(skills).toHaveLength(1);
    expect(links).toEqual([expect.objectContaining({ skillId: skills[0]!.id, order: 0 })]);
  });

  it('S6: workspaces are isolated — the default workspace still has exactly one of each', async () => {
    const { skills, agents, links } = await count(ws);
    expect([skills.length, agents.length, links.length]).toEqual([1, 1, 1]);
  });
});
