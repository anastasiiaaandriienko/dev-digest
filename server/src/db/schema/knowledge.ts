import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  integer,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One run of the Conventions Extractor over a repo (HW2 #38). Persisted so the
 * page survives reloads and a failed / interrupted run keeps its reason. At
 * most one `running` scan per repo (partial unique index).
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'done', 'failed'] }).notNull().default('running'),
    provider: text('provider'),
    model: text('model'),
    /** Repo-relative paths actually sent to the model. */
    sampleFiles: jsonb('sample_files').$type<string[]>(),
    /** Candidates returned by the model / new ones stored after grounding + dedup. */
    candidatesFound: integer('candidates_found'),
    candidatesAdded: integer('candidates_added'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    repoIdx: index('convention_scans_ws_repo_idx').on(t.workspaceId, t.repoId, t.startedAt),
    oneRunning: uniqueIndex('convention_scans_one_running_uq').on(t.repoId).where(sql`status = 'running'`),
  }),
);

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    category: text('category', {
      enum: ['naming', 'structure', 'error_handling', 'types', 'testing', 'imports', 'style', 'api', 'other'],
    })
      .notNull()
      .default('other'),
    evidencePath: text('evidence_path'),
    evidenceLine: integer('evidence_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    /** Kept in sync with `status` (= status === 'accepted') for older readers. */
    accepted: boolean('accepted').notNull().default(false),
    /** pending = not decided yet; rejected rows are kept so a rescan never brings them back. */
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
    /** sha256 of the normalized ORIGINAL rule text; edits never change it. */
    fingerprint: text('fingerprint'),
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' }),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    fingerprintUq: uniqueIndex('conventions_ws_repo_fingerprint_uq').on(t.workspaceId, t.repoId, t.fingerprint),
    statusIdx: index('conventions_ws_repo_status_idx').on(t.workspaceId, t.repoId, t.status),
  }),
);
