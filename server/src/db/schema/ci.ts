import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    /** pending = export PR opened; active = ≥1 ingested run; error = last sync failed (auth/404). */
    status: text('status', { enum: ['pending', 'active', 'error'] }).notNull().default('pending'),
    /** Agent version at export time (shown as the workflow version). */
    agentVersion: integer('agent_version'),
    /** The export PR on the `devdigest/ci` branch. */
    prUrl: text('pr_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Throttles the automatic CI ingest. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  // Unique per agent, NOT per repo: one agent per repo is an MVP service rule only.
  (t) => ({
    agentRepoTargetUq: uniqueIndex('ci_installations_agent_repo_target_uq').on(
      t.agentId,
      t.repo,
      t.targetType,
    ),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    /** The `agent_runs` row (source='ci') this GitHub Actions run was ingested as. */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    commitSha: text('commit_sha'),
    githubRunId: bigint('github_run_id', { mode: 'number' }),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }),
  },
  (t) => ({
    agentRunUq: uniqueIndex('ci_runs_agent_run_id_uq').on(t.agentRunId),
    // Idempotent ingest: a GitHub run is stored once per installation.
    installationGithubRunUq: uniqueIndex('ci_runs_installation_github_run_uq').on(
      t.ciInstallationId,
      t.githubRunId,
    ),
  }),
);
