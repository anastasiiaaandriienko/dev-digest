import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ChatMessage, RunTrace, StructuredRequest } from '@devdigest/shared';
import { formatSkill } from '@devdigest/reviewer-core';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { createAgentRun } from '../src/modules/reviews/repository/run.repo.js';
import { DIFF, REVIEW_FIXTURE } from './helpers/run-cost-fixtures.js';

/**
 * HW2 #14 / #19 / #20 end to end through the REAL executor against a real
 * Postgres: the mock LLM records the messages it was actually sent.
 *  - skills go into the system message in agent_skills order; a reorder
 *    changes the messages;
 *  - skills disabled for the agent or globally (or from another workspace) are
 *    absent from the prompt, the trace and the log;
 *  - the trace records ids / names / versions / order / tokens and the
 *    Skills-only token count, as a run-time snapshot.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const tiktoken = new TiktokenTokenizer();

d('Skills in the review prompt (Testcontainers pg)', () => {
  let pg: PgFixture;
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
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;

  async function skill(name: string, body: string, o: { enabled?: boolean; workspaceId?: string } = {}) {
    const [s] = await db()
      .insert(t.skills)
      .values({
        workspaceId: o.workspaceId ?? ws,
        name,
        description: '',
        type: 'rubric',
        source: 'manual',
        body,
        enabled: o.enabled ?? true,
      })
      .returning();
    return s!;
  }

  /** A fresh repo + PR + agent (repo-intel off → the prompt is skills + task + diff). */
  async function fixture() {
    const n = seq++;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: `skills-${n}`, fullName: `acme/skills-${n}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 900 + n,
        title: 'Change the users API',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `API Contract ${n}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'You are an API contract reviewer.',
        strategy: 'single-pass',
        repoIntel: false,
      })
      .returning();
    return { repo: repo!, pr: pr!, agent: agent! };
  }

  /** Run one review and return what the LLM received + the persisted trace + the log. */
  async function review(f: Awaited<ReturnType<typeof fixture>>) {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = new Container(config(), db(), {
      git: new MockGitClient({ diff: DIFF }),
      llm: { openai: llm },
    });
    const executor = new ReviewRunExecutor(container, container.reviewRepo, container.agentsRepo);
    const runId = await createAgentRun(db(), {
      workspaceId: ws,
      agentId: f.agent.id,
      prId: f.pr.id,
      provider: 'openai',
      model: 'gpt-4.1',
    });
    await executor.executeRuns(ws, f.pr, f.repo, [{ agent: f.agent, runId }]);
    const calls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(calls).toHaveLength(1);
    const messages = (calls[0]!.req as StructuredRequest<unknown>).messages as ChatMessage[];
    const [traceRow] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    const [run] = await db().select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    return {
      runId,
      system: messages[0]!.content,
      user: messages[1]!.content,
      trace: traceRow!.trace as RunTrace,
      log: container.runBus.buffer(runId).map((e) => e.msg),
      replace: (items: { skillId: string; enabled: boolean }[]) =>
        container.agentsRepo.replaceSkills(ws, f.agent.id, items),
    };
  }

  const link = (agentId: string, items: { skillId: string; enabled?: boolean }[]) =>
    db()
      .insert(t.agentSkills)
      .values(items.map((i, order) => ({ agentId, skillId: i.skillId, order, enabled: i.enabled ?? true })));

  it('P1: applied skills are in the SYSTEM message in link order; disabled ones are absent everywhere', async () => {
    const f = await fixture();
    const A = await skill('breaking-change', '# BREAKING-RULE\nFlag removed response fields.');
    const B = await skill('response-schema', '# SCHEMA-RULE\nValidate responses with Zod.');
    const offForAgent = await skill('agent-off', '# AGENT-OFF-RULE');
    const offGlobally = await skill('global-off', '# GLOBAL-OFF-RULE', { enabled: false });
    const foreign = await skill('foreign', '# FOREIGN-RULE', { workspaceId: otherWs });
    // linked directly (bypassing the API) to prove the run itself filters
    await link(f.agent.id, [
      { skillId: A.id },
      { skillId: offForAgent.id, enabled: false },
      { skillId: B.id },
      { skillId: offGlobally.id },
      { skillId: foreign.id },
    ]);

    const r = await review(f);

    // prompt: agent prompt → Skills (A then B) → guard last; nothing in the user message
    const iAgent = r.system.indexOf('You are an API contract reviewer.');
    const iA = r.system.indexOf('# BREAKING-RULE');
    const iB = r.system.indexOf('# SCHEMA-RULE');
    const iGuard = r.system.indexOf('SECURITY — read carefully');
    expect(iAgent).toBe(0);
    expect(iAgent).toBeLessThan(iA);
    expect(iA).toBeLessThan(iB);
    expect(iB).toBeLessThan(iGuard);
    expect(r.user).not.toContain('RULE');
    for (const absent of ['AGENT-OFF-RULE', 'GLOBAL-OFF-RULE', 'FOREIGN-RULE']) {
      expect(r.system).not.toContain(absent);
      expect(r.user).not.toContain(absent);
    }

    // trace: exact applied set, order, versions and token counts
    const pa = r.trace.prompt_assembly;
    expect(pa.skill_blocks).toEqual([
      { skill_id: A.id, name: 'breaking-change', version: 1, order: 0, tokens: tiktoken.count(formatSkill({ name: 'breaking-change', version: 1, body: A.body })) },
      { skill_id: B.id, name: 'response-schema', version: 1, order: 1, tokens: tiktoken.count(formatSkill({ name: 'response-schema', version: 1, body: B.body })) },
    ]);
    expect(r.system).toContain(pa.skills!); // the trace holds exactly what was sent
    // Skills section ONLY: smaller than the whole system message it sits in
    expect(pa.skills_tokens).toBe(tiktoken.count(pa.skills!));
    expect(pa.skills_tokens).toBeLessThan(tiktoken.count(r.system));
    for (const absent of ['agent-off', 'global-off', 'foreign']) {
      expect(JSON.stringify(pa)).not.toContain(absent);
    }

    // log: one applied-skills line, in order, never naming a skill that was not applied
    const line = r.log.find((m) => m.startsWith('skills: '));
    expect(line).toBe(`skills: applied 2 — breaking-change v1 → response-schema v1 (${pa.skills_tokens} tokens)`);
    expect(r.log.join('\n')).not.toMatch(/agent-off|global-off|foreign/);
  });

  it('P2: changing the order changes the messages actually sent to the LLM (and the trace)', async () => {
    const f = await fixture();
    const A = await skill('first', '# FIRST-RULE');
    const B = await skill('second', '# SECOND-RULE');
    await link(f.agent.id, [{ skillId: A.id }, { skillId: B.id }]);

    const before = await review(f);
    expect(before.system.indexOf('# FIRST-RULE')).toBeLessThan(before.system.indexOf('# SECOND-RULE'));

    expect((await before.replace([{ skillId: B.id, enabled: true }, { skillId: A.id, enabled: true }])).kind).toBe('ok');
    const after = await review(f);
    expect(after.system.indexOf('# SECOND-RULE')).toBeLessThan(after.system.indexOf('# FIRST-RULE'));
    expect(after.system).not.toBe(before.system);
    expect(after.trace.prompt_assembly.skill_blocks!.map((s) => s.name)).toEqual(['second', 'first']);
  });

  it('P3: disabling a skill for the agent removes it from the next prompt; re-enabling brings it back in place', async () => {
    const f = await fixture();
    const A = await skill('keep', '# KEEP-RULE');
    const B = await skill('toggle', '# TOGGLE-RULE');
    await link(f.agent.id, [{ skillId: B.id }, { skillId: A.id }]);
    const r = await review(f);

    await r.replace([{ skillId: B.id, enabled: false }, { skillId: A.id, enabled: true }]);
    const off = await review(f);
    expect(off.system).not.toContain('# TOGGLE-RULE');
    expect(off.trace.prompt_assembly.skill_blocks!.map((s) => s.name)).toEqual(['keep']);
    expect(off.log.join('\n')).not.toContain('toggle');

    await r.replace([{ skillId: B.id, enabled: true }, { skillId: A.id, enabled: true }]);
    const on = await review(f);
    expect(on.system.indexOf('# TOGGLE-RULE')).toBeLessThan(on.system.indexOf('# KEEP-RULE'));
  });

  it('P4: the trace is a snapshot — a later edit of the skill does not change what the old trace says', async () => {
    const f = await fixture();
    const A = await skill('versioned', '# OLD-BODY');
    await link(f.agent.id, [{ skillId: A.id }]);
    const r = await review(f);

    await db().update(t.skills).set({ body: '# NEW-BODY', version: 2 }).where(eq(t.skills.id, A.id));
    const [stored] = await db().select().from(t.runTraces).where(eq(t.runTraces.runId, r.runId));
    const pa = (stored!.trace as RunTrace).prompt_assembly;
    expect(pa.skills).toContain('# OLD-BODY');
    expect(pa.skills).not.toContain('# NEW-BODY');
    expect(pa.skill_blocks![0]).toMatchObject({ skill_id: A.id, version: 1 });

    const next = await review(f);
    expect(next.trace.prompt_assembly.skill_blocks![0]).toMatchObject({ version: 2 });
    expect(next.system).toContain('# NEW-BODY');
  });

  it('P5: no skills → no Skills section, null trace fields, "none applied" in the log', async () => {
    const f = await fixture();
    const r = await review(f);
    expect(r.system).not.toContain('## Skills');
    expect(r.trace.prompt_assembly.skills).toBeNull();
    expect(r.trace.prompt_assembly.skill_blocks).toBeNull();
    expect(r.trace.prompt_assembly.skills_tokens).toBeNull();
    expect(r.log).toContain('skills: none applied');
  });
});
