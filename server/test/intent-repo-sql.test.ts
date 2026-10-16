import { describe, it, expect } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '../src/db/schema.js';
import type { Db } from '../src/db/client.js';
import { buildSaveIntentQuery, type SaveIntentValues } from '../src/modules/reviews/repository/intent.repo.js';

/**
 * SQL-shape test for the conditional upsert. The builder is never executed:
 * postgres-js connects lazily, so no database is touched. The behavioural race
 * test (older snapshot vs newer) belongs to the integration lane.
 */
const db = drizzle(postgres('postgres://unused:unused@invalid.invalid:5432/unused'), { schema }) as unknown as Db;

const values: SaveIntentValues = {
  prId: '11111111-1111-4111-8111-111111111111',
  intent: 'i',
  inScope: ['a'],
  outOfScope: [],
  riskAreas: ['r'],
  confidence: 'high',
  inputFingerprint: 'fp',
  promptVersion: 'intent-v1',
  provider: 'openrouter',
  model: 'm',
  headSha: 'sha',
  inputSnapshotAt: new Date('2026-10-16T10:00:00Z'),
  tokensIn: 1,
  tokensOut: 2,
  costUsd: null,
};

describe('saveIntent SQL', () => {
  const { sql } = buildSaveIntentQuery(db, values).toSQL();

  it('is an upsert on pr_id guarded by the snapshot time', () => {
    expect(sql).toContain('insert into "pr_intent"');
    expect(sql).toContain('on conflict ("pr_id") do update set');
    expect(sql).toMatch(
      /where "pr_intent"\."input_snapshot_at" IS NULL OR "pr_intent"\."input_snapshot_at" <= excluded\."input_snapshot_at"/,
    );
  });

  it('returns the written row so "nothing written" is detectable', () => {
    expect(sql).toMatch(/returning "pr_id"$/);
  });

  it('updates every derived column, including fingerprint, model and snapshot', () => {
    for (const col of [
      'intent', 'in_scope', 'out_of_scope', 'risk_areas', 'confidence', 'input_fingerprint',
      'prompt_version', 'provider', 'model', 'head_sha', 'input_snapshot_at', 'generated_at',
      'tokens_in', 'tokens_out', 'cost_usd',
    ]) {
      expect(sql).toContain(`"${col}" = `);
    }
  });
});
