import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { SMART_GROUP_ORDER, SmartDiffResponse } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed, DEFAULT_WORKSPACE_NAME } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * L03 Smart Diff over HTTP + Postgres: GET /pulls/:id/smart-diff groups the
 * stored pr_files with the shared rules, anchors the findings of the latest
 * completed review of each agent and is workspace-scoped.
 *
 * INTEGRATION TEST: needs Docker (testcontainers). Safe run command (guard
 * DATABASE_URL so dotenv can never point the app at the dev DB; GitHub and
 * secrets are mocks, no network and no LLM are used):
 *
 *   cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/smart-diff.it.test.ts
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// new-side lines 1..4: 1 ctx, 2-3 added, 4 ctx.
const PATCH = '@@ -1,2 +1,4 @@ fn()\n a\n+b\n+c\n d';

d('L03 Smart Diff endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let workspaceId: string;
  let otherWs: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    workspaceId = ws!.id;
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

  async function newPr(ws: string, files: { path: string; additions?: number; patch?: string | null }[]) {
    const db = pg.handle.db;
    const name = `smart-${seq++}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 3000 + seq,
        title: 'Smart diff',
        author: 'marisa.koch',
        branch: 'feat/x',
        base: 'main',
        headSha: 'sha-1',
        status: 'needs_review',
      })
      .returning();
    for (const f of files) {
      await db.insert(t.prFiles).values({
        prId: pr!.id,
        path: f.path,
        additions: f.additions ?? 2,
        deletions: 0,
        patch: f.patch === undefined ? PATCH : f.patch,
      });
    }
    return pr!.id;
  }

  async function newAgent(ws: string): Promise<string> {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws, name: `Agent ${seq++}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review' })
      .returning();
    return agent!.id;
  }

  async function addReview(
    prId: string,
    agentId: string,
    minute: number,
    findings: { file: string; start: number; end?: number }[],
    status: 'done' | 'failed' = 'done',
  ) {
    const db = pg.handle.db;
    const [run] = await db.insert(t.agentRuns).values({ workspaceId, agentId, prId, status }).returning();
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId,
        runId: run!.id,
        kind: 'review',
        verdict: 'comment',
        createdAt: new Date(Date.UTC(2026, 9, 17, 10, minute)),
      })
      .returning();
    if (findings.length > 0) {
      await db.insert(t.findings).values(
        findings.map((f, i) => ({
          reviewId: review!.id,
          file: f.file,
          startLine: f.start,
          endLine: f.end ?? f.start,
          severity: 'WARNING',
          category: 'bug',
          title: `f${i}`,
          rationale: 'r',
          confidence: 0.9,
        })),
      );
    }
  }

  const smartDiff = (id: string) => app.inject({ method: 'GET', url: `/pulls/${id}/smart-diff` });

  it('returns the five groups (contract-valid), files sorted by path, with the shared classification', async () => {
    const id = await newPr(workspaceId, [
      { path: 'src/z.ts' },
      { path: 'src/a.ts' },
      { path: 'src/a.test.ts' },
      { path: 'docs/mkdocs.yml' },
      { path: 'README.md' },
      { path: 'pnpm-lock.yaml', patch: null },
    ]);
    const res = await smartDiff(id);
    expect(res.statusCode).toBe(200);
    const body = SmartDiffResponse.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual([...SMART_GROUP_ORDER]);
    const paths = Object.fromEntries(body.groups.map((g) => [g.role, g.files.map((f) => f.path)]));
    expect(paths).toEqual({
      core: ['src/a.ts', 'src/z.ts'],
      tests: ['src/a.test.ts'],
      wiring: ['docs/mkdocs.yml'],
      docs: ['README.md'],
      boilerplate: ['pnpm-lock.yaml'],
    });
    expect(body.split_suggestion).toEqual({ too_big: false, total_lines: 10, proposed_splits: [] });
    expect(body.findings_outside_diff).toBe(0);

    // Deterministic across calls.
    expect((await smartDiff(id)).json()).toEqual(res.json());
  });

  it('anchors findings of the latest completed review per agent; unanchored and outside-diff findings are counted', async () => {
    const id = await newPr(workspaceId, [{ path: 'src/a.ts' }, { path: 'src/b.ts' }]);
    const agentA = await newAgent(workspaceId);
    const agentB = await newAgent(workspaceId);
    // Older review of agent A: replaced by the newer one, must not show.
    await addReview(id, agentA, 1, [{ file: 'src/b.ts', start: 2 }]);
    await addReview(id, agentA, 2, [
      { file: 'src/a.ts', start: 3 },
      { file: 'src/a.ts', start: 1, end: 9 }, // range → largest rendered line (4)
      { file: 'src/a.ts', start: 0 }, // no line
      { file: 'src/a.ts', start: 50 }, // off the changed side
      { file: 'src/gone.ts', start: 1 }, // file not in this diff
    ]);
    // Failed run of agent B: not a completed review, must not show.
    await addReview(id, agentB, 3, [{ file: 'src/b.ts', start: 3 }], 'failed');

    const body = SmartDiffResponse.parse((await smartDiff(id)).json());
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files).toEqual([
      expect.objectContaining({ path: 'src/a.ts', finding_lines: [3, 4], findings_count: 4, unanchored_findings: 2 }),
      expect.objectContaining({ path: 'src/b.ts', finding_lines: [], findings_count: 0, unanchored_findings: 0 }),
    ]);
    expect(body.findings_outside_diff).toBe(1);
  });

  it('suggests a split for a large PR, ignoring boilerplate lines', async () => {
    const id = await newPr(workspaceId, [
      { path: 'src/a.ts', additions: 380 },
      { path: 'src/a.test.ts', additions: 30 },
      { path: 'pnpm-lock.yaml', additions: 4000, patch: null },
    ]);
    const body = SmartDiffResponse.parse((await smartDiff(id)).json());
    expect(body.split_suggestion).toEqual({
      too_big: true,
      total_lines: 410,
      proposed_splits: [
        { name: 'core', files: ['src/a.ts'] },
        { name: 'tests', files: ['src/a.test.ts'] },
      ],
    });
  });

  it('returns five empty groups for a PR without stored files', async () => {
    const body = SmartDiffResponse.parse((await smartDiff(await newPr(workspaceId, []))).json());
    expect(body.groups.every((g) => g.files.length === 0)).toBe(true);
  });

  it('404 for an unknown PR and for a PR of another workspace; 422 for a malformed id', async () => {
    const foreign = await newPr(otherWs, [{ path: 'src/secret.ts' }]);
    const res = await smartDiff(foreign);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('secret.ts');
    expect((await smartDiff('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await smartDiff('not-a-uuid')).statusCode).toBe(422);
  });
});
