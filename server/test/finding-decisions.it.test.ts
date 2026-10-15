import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { DIFF, REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';

/**
 * L01 Accept / Reject — the UI's "Reject" is the existing `dismiss` action.
 * Decisions must persist (survive a reload of GET /pulls/:id/reviews), exclude
 * each other, and fail cleanly for unknown findings / actions.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('L01 finding decisions (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function reviewedPr() {
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        github: new MockGitHubClient({ pulls: [] }),
        git: new MockGitClient({ diff: DIFF }),
        embedder: new MockEmbedder(),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
    const name = `dec-${randomUUID().slice(0, 8)}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Dec ${randomUUID().slice(0, 6)}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr!.id, { expected: 1 });
    const reload = async () =>
      (await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/reviews` })).json()[0].findings[0];
    return { app, reload };
  }

  it('accept, then reject: each persists across a reload and clears the other', async () => {
    const { app, reload } = await reviewedPr();
    const id = (await reload()).id as string;

    expect((await app.inject({ method: 'POST', url: `/findings/${id}/accept` })).statusCode).toBe(200);
    let f = await reload();
    expect(f.accepted_at).not.toBeNull();
    expect(f.dismissed_at).toBeNull();

    expect((await app.inject({ method: 'POST', url: `/findings/${id}/dismiss` })).statusCode).toBe(200);
    f = await reload();
    expect(f.dismissed_at).not.toBeNull();
    expect(f.accepted_at).toBeNull();
    await app.close();
  });

  it('an unknown finding is a 404 and changes nothing', async () => {
    const { app, reload } = await reviewedPr();
    const before = await reload();
    const res = await app.inject({ method: 'POST', url: `/findings/${randomUUID()}/accept` });
    expect(res.statusCode).toBe(404);
    expect(await reload()).toEqual(before);
    await app.close();
  });

  it('only accept and dismiss exist as decision routes', async () => {
    const { app, reload } = await reviewedPr();
    const id = (await reload()).id as string;
    const res = await app.inject({ method: 'POST', url: `/findings/${id}/reject` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
