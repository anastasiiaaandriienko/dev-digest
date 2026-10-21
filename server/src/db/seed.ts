import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { seedBriefFixture } from './seed-brief.js';
import { placeholderLine } from '../modules/context/constants.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- PR Brief fixture (outside `if (!pr)` so a re-seed adds it too) ----
  await seedBriefFixture(db, { prId: pr!.id, headSha: pr!.headSha });

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- Project Context e2e fixtures (opt-in; the dev seed is unchanged) ----
  // Only the hermetic e2e stack sets SEED_CONTEXT_CLONE_PATH (scripts/e2e.sh).
  const contextClonePath = process.env.SEED_CONTEXT_CLONE_PATH?.trim();
  if (contextClonePath) {
    await seedProjectContextFixtures(db, {
      workspaceId,
      repoId,
      prId: pr!.id,
      clonePath: contextClonePath,
    });
  }

  return { workspaceId, userId };
}

/** Model name that marks the seeded Project Context run (idempotency key). */
const CONTEXT_SEED_MODEL = 'seed-context';
const CONTEXT_SEED_DOC = 'docs/spec.md';

/**
 * e2e fixtures for the Project Context flow (AC-CTX-46): point the demo repo at
 * a fixture clone and add ONE finished run for PR #482 whose trace records that
 * `docs/spec.md` was read. The trace holds placeholders only — never doc text
 * (AC-CTX-72). Idempotent.
 */
async function seedProjectContextFixtures(
  db: Db,
  p: { workspaceId: string; repoId: string; prId: string; clonePath: string },
): Promise<void> {
  const [repoRow] = await db.select().from(t.repos).where(eq(t.repos.id, p.repoId));
  if (repoRow && repoRow.clonePath !== p.clonePath) {
    await db.update(t.repos).set({ clonePath: p.clonePath }).where(eq(t.repos.id, p.repoId));
  }

  const [existing] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(
      and(
        eq(t.agentRuns.workspaceId, p.workspaceId),
        eq(t.agentRuns.prId, p.prId),
        eq(t.agentRuns.model, CONTEXT_SEED_MODEL),
      ),
    );
  if (existing) return;

  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, p.workspaceId), eq(t.agents.name, 'General Reviewer')));

  const tokens = 12;
  const line = placeholderLine(CONTEXT_SEED_DOC, tokens, false);
  // Same layout a real redacted trace has: the doc's group heading, then the wrapped placeholder.
  const placeholders = `### Project docs\n<untrusted source="spec-0">\n${line}\n</untrusted>`;
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: p.workspaceId,
      agentId: agent?.id ?? null,
      prId: p.prId,
      provider: 'seed',
      model: CONTEXT_SEED_MODEL,
      durationMs: 1200,
      tokensIn: 0,
      tokensOut: 0,
      status: 'done',
      findingsCount: 0,
      grounding: '0/0 passed',
      source: 'local',
    })
    .returning();

  await db.insert(t.runTraces).values({
    runId: run!.id,
    trace: {
      config: {
        agent: 'General Reviewer',
        version: '1',
        provider: 'seed',
        model: CONTEXT_SEED_MODEL,
        pr: 482,
        source: 'local',
      },
      stats: { duration_ms: 1200, tokens_in: 0, tokens_out: 0, findings: 0, grounding: '0/0 passed' },
      prompt_assembly: {
        system: 'Seeded e2e fixture run (no LLM was called).',
        specs: placeholders,
        user: `## Project context\n${placeholders}`,
        spec_blocks: [
          { path: CONTEXT_SEED_DOC, source: 'agent', status: 'read', tokens, truncated: false },
        ],
        specs_tokens: tokens,
        spec_summary: {
          attached: 1,
          read: 1,
          missing: 0,
          skipped: 0,
          truncated: 0,
          tokens,
          // Run-time snapshot of the limits. Literals on purpose: the L1-L9 constants
          // are imported only by the context module and the executor (AC-CTX-67).
          limits: { doc_bytes: 32768, doc_tokens: 4000, prompt_tokens: 12000, attachments: 10 },
        },
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [CONTEXT_SEED_DOC],
      log: [],
    },
  });
}

// CLI entrypoint
  if (process.argv[1] &&
      fileURLToPath(import.meta.url) === resolve(process.argv[1])
  ) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
