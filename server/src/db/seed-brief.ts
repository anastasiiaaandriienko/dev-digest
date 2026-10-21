import { PrBrief } from '@devdigest/shared';
import type { Db } from './client.js';
import * as t from './schema.js';
import { BRIEF_PROMPT_VERSION } from '../modules/brief/constants.js';
import { defaultFeatureModel } from '../modules/settings/feature-models.js';

/** Unique summary text: e2e asserts on it (AC-BRIEF-44). */
export const SEED_BRIEF_SUMMARY =
  'Seeded brief: adds a token-bucket rate limiter to public API endpoints; the limiter config and middleware are the riskiest parts.';

/** Pure builder for the seeded PR #482 brief. Both focus paths are seeded `pr_files`. */
export function buildSeedBrief(p: { headSha: string }): PrBrief {
  const model = defaultFeatureModel('risk_brief');
  return PrBrief.parse({
    intent: { intent: '', in_scope: [], out_of_scope: [] },
    blast: {
      changed_symbols: [],
      downstream: [],
      summary: 'No blast-radius data for the seeded brief.',
      degraded: true,
      reason: 'no_data',
    },
    summary: SEED_BRIEF_SUMMARY,
    risks: {
      risks: [
        {
          kind: 'reliability',
          title: 'Limiter may reject legitimate traffic',
          explanation: 'A misconfigured bucket size or refill rate could throttle valid clients.',
          severity: 'medium',
          file_refs: ['src/middleware/ratelimit.ts:12'],
        },
        {
          kind: 'security',
          title: 'Rate-limit configuration lives in plain config',
          explanation: 'Limits and related settings are read from src/config.ts; review for secrets and defaults.',
          severity: 'high',
          file_refs: ['src/config.ts:12'],
        },
      ],
    },
    review_focus: [
      { path: 'src/middleware/ratelimit.ts', line: 12, reason: 'Core token-bucket logic of the new limiter.' },
      { path: 'src/config.ts', line: 12, reason: 'Limiter configuration and defaults.' },
    ],
    meta: {
      head_sha: p.headSha,
      provider: model.provider,
      model: model.model,
      prompt_version: BRIEF_PROMPT_VERSION,
      tokens_in: 0,
      tokens_out: 0,
      attempts: 1,
      cost_usd: 0,
      generated_at: '2026-01-01T00:00:00.000Z',
      truncated: false,
      intent_available: false,
    },
  });
}

/** Insert the fixture brief for a PR; an existing row is left untouched. Idempotent. */
export async function seedBriefFixture(db: Db, p: { prId: string; headSha: string }): Promise<void> {
  await db
    .insert(t.prBrief)
    .values({ prId: p.prId, json: buildSeedBrief({ headSha: p.headSha }) })
    .onConflictDoNothing();
}
