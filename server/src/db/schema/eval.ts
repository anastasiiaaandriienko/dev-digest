import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { findings } from './reviews';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose

// L06 columns are NULLable with no DEFAULT on purpose: adding them writes nothing
// into rows that predate L06 (`kind IS NULL` = legacy, ignored by the agent eval
// pipeline). The application sets them on every new row.
export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    /** L06 label: accepted finding → must_find, dismissed finding → must_not_flag. */
    kind: text('kind', { enum: ['must_find', 'must_not_flag'] }),
    /** The finding the case was created from (provenance). */
    sourceFindingId: uuid('source_finding_id').references(() => findings.id, { onDelete: 'set null' }),
    /** sha256 of the frozen input; cases with the same hash share one engine call. */
    inputHash: text('input_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index('eval_cases_ws_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
    oneCasePerFinding: uniqueIndex('eval_cases_owner_finding_uq')
      .on(t.ownerKind, t.ownerId, t.sourceFindingId)
      .where(sql`source_finding_id IS NOT NULL`),
  }),
);

/** One `POST /agents/:id/eval-runs`: an agent version run over all its eval cases. */
export const agentEvalRuns = pgTable(
  'agent_eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    /** Frozen provider/model/strategy/system prompt/skills the run used. */
    configSnapshot: jsonb('config_snapshot').notNull(),
    promptSha: text('prompt_sha').notNull(),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Null when undefined (zero denominator) or the run is not done. */
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    /** Scoring counters (TP/FN/FP by reason, kept/raw findings, tokens). */
    counts: jsonb('counts'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    agentIdx: index('agent_eval_runs_ws_agent_idx').on(t.workspaceId, t.agentId, t.startedAt),
    oneRunning: uniqueIndex('agent_eval_runs_one_running_uq').on(t.agentId).where(sql`status = 'running'`),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    /** L06: the agent eval run this per-case result belongs to (NULL = legacy row). */
    suiteRunId: uuid('suite_run_id').references(() => agentEvalRuns.id, { onDelete: 'cascade' }),
    outcome: text('outcome', { enum: ['tp', 'fn', 'pass', 'fail', 'error'] }),
  },
  (t) => ({
    suiteRunIdx: index('eval_runs_suite_run_idx').on(t.suiteRunId),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
