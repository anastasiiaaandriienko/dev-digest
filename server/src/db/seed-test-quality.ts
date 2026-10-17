import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import type { SkillImportItem } from '@devdigest/shared';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { DEFAULT_WORKSPACE_NAME, SYSTEM_USER_EMAIL } from './seed.js';
import { parseImportFile } from '../modules/skills/import/parse-file.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { AgentsRepository } from '../modules/agents/repository.js';

/**
 * HW2 — reproducible setup of the Test Quality Reviewer agent with the
 * `test-quality` skill (docs/skills/test-quality-reviewer/test-quality.md).
 *
 * Idempotent: re-running never creates a second skill, agent or link, and never
 * overwrites what a user changed since (skill body, agent config, link order or
 * per-agent `enabled`). It reports what it found instead.
 *
 * The skill goes through the same rules as Skills Import (parser, case-insensitive
 * name check under the per-workspace import lock) and is created DISABLED, like
 * every imported skill, unless `enableSkill` is passed explicitly.
 *
 * Not part of `seed()`: the default seed keeps its three built-in agents.
 */

export const TEST_QUALITY_SKILL_NAME = 'test-quality';
export const TEST_QUALITY_AGENT_NAME = 'Test Quality Reviewer';

/**
 * Deliberately short and rubric-free: the A/B experiment varies ONLY the skill
 * link, so the system prompt must not already contain the test-quality rules.
 */
export const TEST_QUALITY_AGENT_PROMPT =
  'You review pull requests for the quality of the tests they add or change. Report only problems visible in the diff.';

export const TEST_QUALITY_AGENT_DESCRIPTION =
  'Flags tests that cover only the happy path: missing negative, boundary, error and async-rejection cases.';

/** Same provider/model as the built-in agents and the API Contract A/B run. */
export const TEST_QUALITY_PROVIDER = 'openrouter' as const;
export const TEST_QUALITY_MODEL = 'deepseek/deepseek-v4-flash';

const SKILL_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'docs', 'skills', 'test-quality-reviewer', 'test-quality.md',
);

/** The skill as Skills Import would see it (name, description, type, body). */
export function loadTestQualitySkill(path = SKILL_FILE): SkillImportItem {
  const parsed = parseImportFile('test-quality.md', readFileSync(path));
  const [c] = parsed.candidates;
  if (!c || c.issues.length > 0) throw new Error(`test-quality skill is not importable: ${JSON.stringify(c?.issues)}`);
  return { name: c.name, description: c.description, type: c.type, body: c.body };
}

export interface SeedTestQualityResult {
  skillId: string;
  agentId: string;
  skillCreated: boolean;
  agentCreated: boolean;
  linkCreated: boolean;
  /** False when an existing skill's body differs from the file (left untouched). */
  skillBodyMatchesFile: boolean;
  skillEnabled: boolean;
  linkEnabled: boolean;
}

export async function seedTestQualityReviewer(
  db: Db,
  opts: { workspaceId: string; userId?: string | null; enableSkill?: boolean; skill?: SkillImportItem },
): Promise<SeedTestQualityResult> {
  const { workspaceId } = opts;
  const item = opts.skill ?? loadTestQualitySkill();
  const skills = new SkillsRepository(db);
  const agents = new AgentsRepository(db);

  // ---- skill (import semantics: case-insensitive name, created disabled) ----
  let skillCreated = false;
  const created = await skills.createImported(workspaceId, [item]);
  if (created.kind === 'created') skillCreated = true;
  const [skill] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), sql`lower(${t.skills.name}) = ${item.name.toLowerCase()}`))
    .orderBy(t.skills.createdAt)
    .limit(1);
  if (!skill) throw new Error('test-quality skill was neither created nor found');
  let skillEnabled = skill.enabled;
  if (opts.enableSkill && !skill.enabled) {
    await db.update(t.skills).set({ enabled: true }).where(eq(t.skills.id, skill.id));
    skillEnabled = true;
  }

  // ---- agent (matched by workspace + exact name; config never overwritten) ----
  let agentCreated = false;
  let [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, TEST_QUALITY_AGENT_NAME)))
    .orderBy(t.agents.createdAt)
    .limit(1);
  if (!agent) {
    agent = await agents.insert({
      workspaceId,
      name: TEST_QUALITY_AGENT_NAME,
      description: TEST_QUALITY_AGENT_DESCRIPTION,
      provider: TEST_QUALITY_PROVIDER,
      model: TEST_QUALITY_MODEL,
      systemPrompt: TEST_QUALITY_AGENT_PROMPT,
      strategy: 'single-pass',
      enabled: true,
      createdBy: opts.userId ?? null,
    });
    agentCreated = true;
  }

  // ---- link (appended once; existing order / enabled preserved) ----
  const links = await agents.linkedSkills(agent.id);
  const existing = links.find((l) => l.skill.id === skill.id);
  let linkCreated = false;
  if (!existing) {
    await agents.linkSkill(agent.id, skill.id, links.length);
    linkCreated = true;
  }

  return {
    skillId: skill.id,
    agentId: agent.id,
    skillCreated,
    agentCreated,
    linkCreated,
    skillBodyMatchesFile: skill.body === item.body,
    skillEnabled,
    linkEnabled: existing ? existing.enabled : true,
  };
}

// CLI: DATABASE_URL=… pnpm exec tsx src/db/seed-test-quality.ts [--enable-skill]
// Needs the default workspace + system user from `pnpm db:seed`.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  (async () => {
    const [ws] = await handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
    const [user] = await handle.db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
    if (!ws) throw new Error('default workspace not found — run `pnpm db:seed` first');
    return seedTestQualityReviewer(handle.db, {
      workspaceId: ws.id,
      userId: user?.id ?? null,
      enableSkill: process.argv.includes('--enable-skill'),
    });
  })()
    .then(async (r) => {
      console.log('✓ test-quality reviewer', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ test-quality reviewer seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
