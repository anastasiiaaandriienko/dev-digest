import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';
import type { IntentContextSourceRecord } from '../../../db/schema.js';
import { getPrFiles, getPull, getRepo } from './pull.repo.js';

/**
 * L03 Intent block — `pr_intent` data access. Plain functions of `(db, …)`;
 * no LLM and no transaction here (the service never holds a connection across
 * the model call).
 */

export type IntentRow = typeof t.prIntent.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;

export async function getIntentRow(db: Db, prId: string): Promise<IntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  return row;
}

/** What the intent is derived from, read once. `snapshotAt` = when it was read. */
export interface IntentInputs {
  pull: PullRow;
  files: PrFileRow[];
  snapshotAt: Date;
  /** The PR's repository (owner/name scope linked-issue lookups); absent/null = unknown, issues are not fetched. */
  repo?: { owner: string; name: string } | null;
}

/**
 * The PR (workspace-scoped) and its stored files, with the moment they were read.
 * Reads local rows only — never GitHub.
 */
export async function getIntentInputs(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<IntentInputs | undefined> {
  const snapshotAt = new Date();
  const pull = await getPull(db, workspaceId, prId);
  if (!pull) return undefined;
  const [files, repoRow] = await Promise.all([getPrFiles(db, prId), getRepo(db, pull.repoId)]);
  const repo = repoRow ? { owner: repoRow.owner, name: repoRow.name } : null;
  return { pull, files, snapshotAt, repo };
}

export interface SaveIntentValues {
  prId: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
  riskAreas: string[];
  confidence: string;
  inputFingerprint: string;
  promptVersion: string;
  provider: string;
  model: string;
  headSha: string;
  inputSnapshotAt: Date;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  /** Context sources the intent was generated from (no fetched bodies). */
  contextSources: IntentContextSourceRecord[];
}

/**
 * Upsert guard: an older input snapshot must never overwrite a newer one.
 * Columns are spelled out because inside ON CONFLICT … DO UPDATE an unqualified
 * column is ambiguous between the target row and `excluded`.
 */
export const SAVE_INTENT_WHERE = sql`"pr_intent"."input_snapshot_at" IS NULL OR "pr_intent"."input_snapshot_at" <= excluded."input_snapshot_at"`;

/** The conditional upsert as a (not yet executed) builder — unit tests read `.toSQL()`. */
export function buildSaveIntentQuery(db: Db, v: SaveIntentValues) {
  const set = {
    intent: v.intent,
    inScope: v.inScope,
    outOfScope: v.outOfScope,
    riskAreas: v.riskAreas,
    confidence: v.confidence,
    inputFingerprint: v.inputFingerprint,
    promptVersion: v.promptVersion,
    provider: v.provider,
    model: v.model,
    headSha: v.headSha,
    inputSnapshotAt: v.inputSnapshotAt,
    generatedAt: sql`now()`,
    tokensIn: v.tokensIn,
    tokensOut: v.tokensOut,
    costUsd: v.costUsd,
    contextSources: v.contextSources,
  };
  return db
    .insert(t.prIntent)
    .values({ ...v, generatedAt: new Date() })
    .onConflictDoUpdate({ target: t.prIntent.prId, set, setWhere: SAVE_INTENT_WHERE })
    .returning({ prId: t.prIntent.prId });
}

/** Returns true when the row was written, false when a newer snapshot already holds it. */
export async function saveIntent(db: Db, v: SaveIntentValues): Promise<boolean> {
  const rows = await buildSaveIntentQuery(db, v);
  return rows.length > 0;
}
