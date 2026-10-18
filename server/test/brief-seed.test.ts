// Pure unit test: no network, no DB, no LLM.
import { describe, it, expect } from 'vitest';
import { PrBrief } from '@devdigest/shared';
import { buildSeedBrief } from '../src/db/seed-brief.js';
import { evaluateBriefFreshness } from '../src/modules/brief/helpers.js';
import { defaultFeatureModel } from '../src/modules/settings/feature-models.js';

describe('brief seed fixture', () => {
  it('AC-BRIEF-44 seeded brief fixture parses as PrBrief and is fresh for the seeded head', () => {
    const brief = buildSeedBrief({ headSha: 'a1b2c3d4e5f6' });
    expect(PrBrief.safeParse(brief).success).toBe(true);
    expect(brief.risks.risks).toHaveLength(2);
    expect(brief.review_focus?.map((f) => `${f.path}:${f.line}`)).toEqual([
      'src/middleware/ratelimit.ts:12',
      'src/config.ts:12',
    ]);
    const res = evaluateBriefFreshness(brief, {
      headSha: 'a1b2c3d4e5f6',
      model: defaultFeatureModel('risk_brief'),
    });
    expect(res).toEqual({ freshness: 'fresh', stale_reasons: [] });
  });
});
