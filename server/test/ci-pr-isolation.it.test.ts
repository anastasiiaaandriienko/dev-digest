import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { createDb, type Db, type DbHandle } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { listRunsForPull } from '../src/modules/reviews/repository/run.repo.js';
import { costByPullRequest } from '../src/modules/pulls/cost.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

/**
 * L07 — ingested CI runs stay out of the local PR views (specs/export-to-ci.md
 * §6.4): a CI run that carries an imported PR's id is neither listed in that
 * PR's run history (GET /pulls/:id/runs) nor summed into its cost on the PR
 * list. Local runs and their cost figures are unchanged.
 *
 * Database: Testcontainers (skipped without Docker) or DEVDIGEST_IT_DB_URL =
 * the isolated `devdigest_export_ci` (anything else fails). Every row lives in
 * this file's workspaces, which are deleted at the end.
 */

const EXTERNAL_DB = 'devdigest_export_ci';
const externalUrl = process.env.DEVDIGEST_IT_DB_URL;
if (externalUrl && new URL(externalUrl).pathname !== `/${EXTERNAL_DB}`) {
  throw new Error(`DEVDIGEST_IT_DB_URL must point at the isolated "${EXTERNAL_DB}" database`);
}
const enabled = externalUrl ? true : await dockerAvailable();
const d = enabled ? describe : describe.skip;

d('CI runs vs the local PR run history and PR cost (real Postgres)', () => {
  let pg: PgFixture | undefined;
  let handle: DbHandle;
  let db: Db;
  const workspaces: string[] = [];

  beforeAll(async () => {
    if (externalUrl) handle = createDb(externalUrl, { max: 4 });
    else {
      pg = await startPg();
      handle = pg.handle;
    }
    db = handle.db;
  });

  afterAll(async () => {
    if (!db) return;
    if (workspaces.length > 0) await db.delete(t.workspaces).where(inArray(t.workspaces.id, workspaces));
    const [left] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from agent_runs where workspace_id in (${sql.join(
        workspaces.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    expect(left!.n).toBe(0);
    if (externalUrl) await handle.close();
    else await pg?.stop();
  });

  /** A workspace with one repo, one agent and two imported PRs. */
  async function fixture() {
    const [w] = await db.insert(t.workspaces).values({ name: `ci-pr-it-${randomUUID()}` }).returning();
    workspaces.push(w!.id);
    const name = `widgets-${randomUUID().slice(0, 8)}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId: w!.id, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [agent] = await db
      .insert(t.agents)
      .values({ workspaceId: w!.id, name: 'Security Reviewer', provider: 'openai', model: 'gpt-4.1', systemPrompt: 'x' })
      .returning();
    const pr = async (number: number) =>
      (
        await db
          .insert(t.pullRequests)
          .values({ workspaceId: w!.id, repoId: repo!.id, number, title: `PR ${number}`, author: 'a', branch: 'b', base: 'main', headSha: 'x', status: 'open' })
          .returning()
      )[0]!;
    return { ws: w!.id, agentId: agent!.id, pr1: await pr(1), pr2: await pr(2) };
  }

  /** One run with a trace carrying `stats.cost_usd` (the shape both sources write). */
  async function run(
    ws: string,
    agentId: string,
    prId: string,
    opts: { source: 'local' | 'ci'; status: string; cost: number | null; ranAt: Date },
  ) {
    const [r] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: ws, agentId, prId, source: opts.source, status: opts.status, ranAt: opts.ranAt, provider: 'openai', model: 'gpt-4.1' })
      .returning();
    await db.insert(t.runTraces).values({ runId: r!.id, trace: { stats: { cost_usd: opts.cost } } });
    return r!.id;
  }

  it('the PR run history lists the local runs (newest first) and none of the CI runs', async () => {
    const f = await fixture();
    const t0 = Date.parse('2026-10-20T10:00:00Z');
    const localOld = await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'done', cost: 0.01, ranAt: new Date(t0) });
    const localFailed = await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'failed', cost: null, ranAt: new Date(t0 + 1000) });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'ci', status: 'done', cost: 0.5, ranAt: new Date(t0 + 2000) });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'ci', status: 'failed', cost: null, ranAt: new Date(t0 + 3000) });

    const history = await listRunsForPull(db, f.ws, f.pr1.id);
    expect(history.map((r) => r.run_id)).toEqual([localFailed, localOld]);
    expect(history.map((r) => [r.status, r.cost_usd])).toEqual([
      ['failed', null],
      ['done', 0.01],
    ]);
  });

  it('a PR with only CI runs has an empty local history', async () => {
    const f = await fixture();
    await run(f.ws, f.agentId, f.pr2.id, { source: 'ci', status: 'done', cost: 0.5, ranAt: new Date() });
    expect(await listRunsForPull(db, f.ws, f.pr2.id)).toEqual([]);
  });

  it('PR cost sums the done local runs only; CI spend is not added and does not make the figure partial', async () => {
    const f = await fixture();
    const at = new Date();
    // pr1: two priced local runs + an unpriced local run (partial) + a failed local run (ignored)
    await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'done', cost: 0.01, ranAt: at });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'done', cost: 0.02, ranAt: at });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'done', cost: null, ranAt: at });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'failed', cost: 9, ranAt: at });
    // CI runs on both PRs: one priced, one unpriced (would flip `cost_partial` if counted)
    await run(f.ws, f.agentId, f.pr1.id, { source: 'ci', status: 'done', cost: 0.5, ranAt: at });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'ci', status: 'done', cost: null, ranAt: at });
    await run(f.ws, f.agentId, f.pr2.id, { source: 'ci', status: 'done', cost: 0.7, ranAt: at });

    const costs = await costByPullRequest(db, f.ws, [f.pr1.id, f.pr2.id]);
    expect(costs.get(f.pr1.id)!.cost_usd).toBeCloseTo(0.03, 10);
    expect(costs.get(f.pr1.id)!.cost_partial).toBe(true);
    // pr2 has CI runs only → no local cost row (the route maps it to NO_COST)
    expect(costs.has(f.pr2.id)).toBe(false);
  });

  it('a fully priced set of local runs stays exact and not partial next to an unpriced CI run', async () => {
    const f = await fixture();
    const at = new Date();
    await run(f.ws, f.agentId, f.pr1.id, { source: 'local', status: 'done', cost: 0.01, ranAt: at });
    await run(f.ws, f.agentId, f.pr1.id, { source: 'ci', status: 'done', cost: null, ranAt: at });

    const costs = await costByPullRequest(db, f.ws, [f.pr1.id]);
    expect(costs.get(f.pr1.id)).toEqual({ cost_usd: 0.01, cost_partial: false });
  });
});
