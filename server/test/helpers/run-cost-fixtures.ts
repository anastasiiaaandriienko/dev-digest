import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider } from '../../src/adapters/mocks.js';
import type { AgentRow, PullRow } from '../../src/db/rows.js';
import type * as schema from '../../src/db/schema.js';

/**
 * Shared fixtures for the L01 run-cost / finalization tests
 * (specs/review-run-cost.md §9.1).
 */

/** A unified diff touching src/config.ts (line 11 added). */
export const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** One finding grounded on line 11 → 1 kept finding, 1 CRITICAL blocker. */
export const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/**
 * MockLLMProvider always reports costUsd 0.001; this one reports whatever the
 * test needs (a number, 0, or null = unknown).
 */
export class CostLLMProvider extends MockLLMProvider {
  constructor(private readonly cost: number | null) {
    super('openai', { structured: REVIEW_FIXTURE });
  }

  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const res = await super.completeStructured(req);
    return { ...res, costUsd: this.cost };
  }
}

/** An agent row with repo-intel off, so no enrichment touches the DB. */
export function agentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    workspaceId: '00000000-0000-4000-8000-0000000000f1',
    name: 'Cost Reviewer',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  };
}

/** A minimal PR row (only the fields the executor reads matter). */
export function pullRow(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    workspaceId: '00000000-0000-4000-8000-0000000000f1',
    repoId: '00000000-0000-4000-8000-0000000000c1',
    number: 482,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    headSha: 'a1b2c3d4',
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    ...overrides,
  } as PullRow;
}

export function repoRow(
  overrides: Partial<typeof schema.repos.$inferSelect> = {},
): typeof schema.repos.$inferSelect {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    workspaceId: '00000000-0000-4000-8000-0000000000f1',
    owner: 'acme',
    name: 'payments-api',
    fullName: 'acme/payments-api',
    ...overrides,
  } as typeof schema.repos.$inferSelect;
}
