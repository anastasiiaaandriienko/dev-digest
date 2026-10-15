import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Agent, ChatMessage, RunTrace, Skill, SkillImportPreview, StructuredRequest } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { createAgentRun } from '../src/modules/reviews/repository/run.repo.js';
import { DIFF, REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';
import { buildZip, toBase64 } from './helpers/zip-builder.js';

/**
 * HW2 #15 / #16 over HTTP against a real Postgres (Testcontainers):
 *  - preview parses .md / .zip and saves nothing; taken names are flagged;
 *  - import creates source `imported`, disabled, v1 (+ version row), all or
 *    nothing; duplicate names → 409, also under concurrent imports;
 *  - unsafe files / bodies → 415 / 413 / 422 with nothing written;
 *  - #16: a NEW agent, a skill imported through the API, reviewed, enabled and
 *    attached, then a real executor run (mock LLM): the imported skill is in
 *    the system message and in the trace.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const SKILL_MD =
  '---\nname: imported-test-quality\ndescription: Flag happy-path-only tests\ntype: rubric\n---\n\n# Test quality\nFlag tests that only cover the happy path.\n';

d('Skill import (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let ws: string;
  let otherWs: string;

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
  const skillCount = async () =>
    (await db().select({ n: sql<number>`count(*)::int` }).from(t.skills).where(eq(t.skills.workspaceId, ws)))[0]!.n;
  const preview = (filename: string, content: Uint8Array | string) =>
    app.inject({ method: 'POST', url: '/skills/import/preview', payload: { filename, content_base64: toBase64(content) } });
  const importItems = (items: unknown[]) => app.inject({ method: 'POST', url: '/skills/import', payload: { items } });
  const item = (name: string, o: Record<string, unknown> = {}) => ({ name, description: 'd', type: 'rubric', body: `# ${name}\nRule.`, ...o });

  it('I1: preview of a .md proposes the skill and writes nothing', async () => {
    const before = await skillCount();
    const res = await preview('test-quality.md', SKILL_MD);
    expect(res.statusCode).toBe(200);
    const p = res.json() as SkillImportPreview;
    expect(p).toMatchObject({ filename: 'test-quality.md', format: 'md', skipped: [] });
    expect(p.items).toEqual([
      {
        path: 'test-quality.md',
        name: 'imported-test-quality',
        description: 'Flag happy-path-only tests',
        type: 'rubric',
        body: '# Test quality\nFlag tests that only cover the happy path.\n',
        issues: [],
      },
    ]);
    expect(await skillCount()).toBe(before);
  });

  it('I2: preview of a .zip lists every skill and flags names already taken (case-insensitive)', async () => {
    await importItems([item('preview-taken')]);
    const zip = buildZip([
      { name: 'pack/' },
      { name: 'pack/a.md', data: '---\nname: Preview-Taken\n---\n# A' },
      { name: 'pack/fresh.md', data: '# Fresh' },
    ]);
    const p = (await preview('pack.zip', zip)).json() as SkillImportPreview;
    expect(p.format).toBe('zip');
    expect(p.items.map((i) => [i.name, i.issues.map((x) => x.message)])).toEqual([
      ['Preview-Taken', expect.arrayContaining(['A skill named "Preview-Taken" already exists'])],
      ['fresh', []],
    ]);
    expect(p.skipped).toEqual(['pack/']);
  });

  it('I3: unsafe or unsupported files are refused with nothing written', async () => {
    const before = await skillCount();
    const traversal = await preview('evil.zip', buildZip([{ name: '../../etc/evil.md', data: '# x' }]));
    expect(traversal.statusCode).toBe(422);
    expect(traversal.json().error).toMatchObject({ code: 'unsafe_archive', details: { entries: [{ path: '../../etc/evil.md', reason: 'path traversal (..)' }] } });

    const bomb = await preview('bomb.zip', buildZip([{ name: 'bomb.md', data: 'a'.repeat(500_000) }]));
    expect(bomb.statusCode).toBe(422);
    expect(bomb.json().error.details.entries[0].reason).toMatch(/zip bomb/);

    const exe = await preview('tool.exe', 'MZ');
    expect(exe.statusCode).toBe(415);
    expect(exe.json().error.code).toBe('unsupported_file_type');

    expect((await preview('fake.md', '#!/bin/sh\necho')).statusCode).toBe(422);
    expect((await preview('broken.zip', 'PK\u0003\u0004 not really')).statusCode).toBe(422);
    const badBase64 = await app.inject({ method: 'POST', url: '/skills/import/preview', payload: { filename: 'a.md', content_base64: '%%%' } });
    expect(badBase64.statusCode).toBe(422);
    expect(await skillCount()).toBe(before);
  });

  it('I4: an upload over the route body limit is refused with 413', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'big.md', content_base64: 'A'.repeat(3 * 1024 * 1024 + 16) },
    });
    expect(res.statusCode).toBe(413);
  });

  it('I5: import creates the skills as imported, DISABLED, version 1, with their version row', async () => {
    const res = await importItems([item('import-one', { type: 'security' }), item('import-two')]);
    expect(res.statusCode).toBe(201);
    const created = res.json() as Skill[];
    expect(created.map((s) => [s.name, s.source, s.enabled, s.version, s.type, s.agent_count])).toEqual([
      ['import-one', 'imported', false, 1, 'security', 0],
      ['import-two', 'imported', false, 1, 'rubric', 0],
    ]);
    const [row] = await db().select().from(t.skills).where(eq(t.skills.id, created[0]!.id));
    expect(row).toMatchObject({ workspaceId: ws, source: 'imported', enabled: false });
    const versions = await db().select().from(t.skillVersions).where(eq(t.skillVersions.skillId, created[0]!.id));
    expect(versions.map((v) => [v.version, v.body])).toEqual([[1, '# import-one\nRule.']]);
  });

  it('I6: a taken name → 409 and NOTHING of the batch is written (all or nothing)', async () => {
    await importItems([item('dup-existing')]);
    const before = await skillCount();
    const res = await importItems([item('brand-new-in-batch'), item('DUP-EXISTING'.toLowerCase())]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'conflict', details: { names: ['dup-existing'] } });
    expect(await skillCount()).toBe(before);
  });

  it('I7: the same name twice in one request → 409', async () => {
    const res = await importItems([item('twice-name'), item('twice-name', { body: '# other' })]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toEqual({ names: ['twice-name'] });
  });

  it('I8: a name taken only in ANOTHER workspace does not conflict', async () => {
    await db().insert(t.skills).values({ workspaceId: otherWs, name: 'cross-ws', description: '', type: 'rubric', source: 'manual', body: '# x' });
    expect((await importItems([item('cross-ws')])).statusCode).toBe(201);
  });

  it('I9: concurrent imports of the same name create it exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => importItems([item('race-name', { body: `# r${i}` })])));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    const rows = await db().select().from(t.skills).where(and(eq(t.skills.workspaceId, ws), eq(t.skills.name, 'race-name')));
    expect(rows).toHaveLength(1);
  });

  it('I10: the import body re-applies every content rule (client edits are not trusted)', async () => {
    const before = await skillCount();
    for (const bad of [
      item('script-body', { body: '# x\n<script>alert(1)</script>' }),
      item('Bad Name'),
      item('empty-body', { body: '   ' }),
      item('bad-type', { type: 'linter' }),
      item('ctrl', { description: 'a\u0007b' }),
    ]) {
      const res = await importItems([bad]);
      expect(res.statusCode, JSON.stringify(bad)).toBe(422);
    }
    expect((await importItems([])).statusCode).toBe(422);
    expect(await skillCount()).toBe(before);

    // The shape the client maps back onto the preview (ImportSkillModal/helpers.ts `issuePath`).
    const res = await importItems([item('fine'), item('script-body', { body: '<script>x</script>' })]);
    expect(res.json().error.details[0]).toMatchObject({
      instancePath: '/items/1/body',
      params: { issue: { path: ['items', 1, 'body'] } },
      message: 'Executable content is not allowed (<script> tag); put examples in code spans',
    });
  });

  it('I12: the total body size of one import is capped by the schema (422, not a bare 413)', async () => {
    const big = 'x'.repeat(190_000);
    const items = Array.from({ length: 30 }, (_, i) => item(`big-${i}`, { body: `# b\n${big}` }));
    const res = await importItems(items);
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json().error.details)).toContain('Skills in one import may total at most');
  });

  it('I11: manual POST /skills is unchanged (it may still reuse a name; it is enabled by default)', async () => {
    const res = await app.inject({ method: 'POST', url: '/skills', payload: { name: 'import-one', type: 'rubric', body: '# m' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ source: 'manual', enabled: true });
  });

  it('#16: new agent + imported skill (reviewed, enabled, attached) → in the prompt and the trace of a real run', async () => {
    // 1. A brand-new agent, created through the API.
    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Import Check Agent', description: 'x', provider: 'openai', model: 'gpt-4.1', system_prompt: 'You review tests.', repo_intel: false },
    });
    expect(agentRes.statusCode).toBe(201);
    const agent = agentRes.json() as Agent;

    // 2. Import through the workflow: preview → (review) → import. It lands disabled.
    const p = (await preview('test-quality.md', SKILL_MD)).json() as SkillImportPreview;
    const [candidate] = p.items;
    expect(candidate!.issues).toEqual([]);
    const created = (await importItems([{ name: candidate!.name, description: candidate!.description, type: candidate!.type, body: candidate!.body }])).json() as Skill[];
    const imported = created[0]!;
    expect(imported).toMatchObject({ source: 'imported', enabled: false });

    // 3. Attached while still disabled globally → NOT applied.
    const attach = await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [{ skill_id: imported.id, enabled: true }] } });
    expect(attach.statusCode).toBe(200);
    const fixture = await prFixture();
    const before = await review(agent.id, fixture);
    expect(before.system).not.toContain('imported-test-quality');
    expect(before.trace.prompt_assembly.skill_blocks ?? []).toEqual([]);

    // 4. Reviewed → enabled explicitly → applied.
    const enable = await app.inject({ method: 'PUT', url: `/skills/${imported.id}`, payload: { enabled: true } });
    expect(enable.json()).toMatchObject({ enabled: true, source: 'imported', agent_count: 1 });
    const after = await review(agent.id, fixture);
    expect(after.system).toContain('<skill name="imported-test-quality" version="1">');
    expect(after.system).toContain('Flag tests that only cover the happy path.');
    expect(after.trace.prompt_assembly.skill_blocks).toEqual([
      { skill_id: imported.id, name: 'imported-test-quality', version: 1, order: 0, tokens: expect.any(Number) },
    ]);
    expect(after.trace.prompt_assembly.skills).toContain('<skill name="imported-test-quality" version="1">');
    expect(after.log).toContain('skills: applied 1 — imported-test-quality v1 (' + after.trace.prompt_assembly.skills_tokens + ' tokens)');
  });

  async function prFixture() {
    const [repo] = await db().insert(t.repos).values({ workspaceId: ws, owner: 'acme', name: 'import', fullName: 'acme/import' }).returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 77,
        title: 'Add tests',
        author: 'dev',
        branch: 'feat/tests',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  /** One executor run with a mock LLM: what the model received, the trace and the log. */
  async function review(agentId: string, f: Awaited<ReturnType<typeof prFixture>>) {
    const [agent] = await db().select().from(t.agents).where(eq(t.agents.id, agentId));
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = new Container(config(), db(), { git: new MockGitClient({ diff: DIFF }), llm: { openai: llm } });
    const executor = new ReviewRunExecutor(container, container.reviewRepo, container.agentsRepo);
    const runId = await createAgentRun(db(), { workspaceId: ws, agentId, prId: f.pr.id, provider: 'openai', model: 'gpt-4.1' });
    await executor.executeRuns(ws, f.pr, f.repo, [{ agent: agent!, runId }]);
    const call = llm.calls.find((c) => c.method === 'completeStructured')!;
    const messages = (call.req as StructuredRequest<unknown>).messages as ChatMessage[];
    const [traceRow] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    return { system: messages[0]!.content, trace: traceRow!.trace as RunTrace, log: container.runBus.buffer(runId).map((e) => e.msg) };
  }
});
