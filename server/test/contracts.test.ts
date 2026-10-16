import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  RunStats,
  RunSummary,
  Settings,
  Repo,
  PrDetail,
  PrMeta,
  PrIntentState,
  IntentRunRequest,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({ intent: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

// L01 cost badge (specs/review-run-cost.md §5, T8): number, null and — where the
// field is optional — missing all parse; null is never coerced to 0.
describe('L01 cost contracts', () => {
  const stats = { duration_ms: 1, tokens_in: 1, tokens_out: 1, findings: 0, grounding: '0/0 passed' };
  const summary = {
    run_id: 'r1',
    agent_id: null,
    agent_name: null,
    provider: null,
    model: null,
    status: 'done',
    error: null,
    duration_ms: 1,
    tokens_in: 1,
    tokens_out: 1,
    findings_count: 0,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
  };
  const pr = {
    number: 482,
    title: 't',
    author: 'a',
    branch: 'b',
    base: 'main',
    head_sha: 'sha',
    additions: 0,
    deletions: 0,
    files_count: 0,
    status: 'open',
  };

  it('RunStats.cost_usd: number, 0, null and missing (old traces) parse', () => {
    expect(RunStats.parse({ ...stats, cost_usd: 0.001 }).cost_usd).toBe(0.001);
    expect(RunStats.parse({ ...stats, cost_usd: 0 }).cost_usd).toBe(0);
    expect(RunStats.parse({ ...stats, cost_usd: null }).cost_usd).toBeNull();
    expect(RunStats.parse(stats).cost_usd).toBeUndefined();
    expect(RunStats.safeParse({ ...stats, cost_usd: -1 }).success).toBe(false);
  });

  it('RunSummary.cost_usd is required-but-nullable (the runs endpoint always sends it)', () => {
    expect(RunSummary.parse({ ...summary, cost_usd: 0.002 }).cost_usd).toBe(0.002);
    expect(RunSummary.parse({ ...summary, cost_usd: null }).cost_usd).toBeNull();
    expect(RunSummary.safeParse(summary).success).toBe(false);
  });

  it('PrMeta.cost_usd / cost_partial: list-only, number / null / missing parse', () => {
    expect(PrMeta.parse({ ...pr, cost_usd: 0.42, cost_partial: true })).toMatchObject({
      cost_usd: 0.42,
      cost_partial: true,
    });
    expect(PrMeta.parse({ ...pr, cost_usd: null, cost_partial: false }).cost_usd).toBeNull();
    expect(PrMeta.parse(pr).cost_usd).toBeUndefined();
    expect(PrMeta.safeParse({ ...pr, cost_partial: 'yes' }).success).toBe(false);
  });
});

describe('L03 intent contracts', () => {
  const base = { intent: 'Add retry to webhooks', in_scope: ['retry'], out_of_scope: ['queue'] };

  it('Intent parses with and without risk_areas (pre-L03 payloads)', () => {
    expect(Intent.parse(base).risk_areas).toBeUndefined();
    expect(Intent.parse({ ...base, risk_areas: ['billing'] }).risk_areas).toEqual(['billing']);
    expect(Intent.safeParse({ ...base, risk_areas: 'billing' }).success).toBe(false);
  });

  it('PrIntentState parses a fresh state and an empty (never generated) one', () => {
    const model = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', source: 'fallback_onboarding' };
    const fresh = PrIntentState.parse({
      pr_id: 'pr-1',
      intent: { ...base, risk_areas: [] },
      meta: {
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        prompt_version: 'intent-v1',
        confidence: 'medium',
        generated_at: '2026-10-16T10:00:00.000Z',
        head_sha: 'abc',
        input_snapshot_at: '2026-10-16T09:59:59.000Z',
        tokens_in: 100,
        tokens_out: 50,
        cost_usd: null,
      },
      freshness: 'stale',
      stale_reasons: ['pr_changed', 'model_changed'],
      current_model: model,
      computed: false,
    });
    expect(fresh.stale_reasons).toEqual(['pr_changed', 'model_changed']);
    const empty = PrIntentState.parse({
      pr_id: 'pr-1',
      intent: null,
      meta: null,
      freshness: 'unknown',
      stale_reasons: [],
      current_model: null,
      model_error: 'No model',
    });
    expect(empty.intent).toBeNull();
    expect(PrIntentState.safeParse({ ...empty, freshness: 'old' }).success).toBe(false);
    expect(PrIntentState.safeParse({ ...empty, stale_reasons: ['nope'] }).success).toBe(false);
  });

  it('IntentRunRequest defaults force to false', () => {
    expect(IntentRunRequest.parse({})).toEqual({ force: false });
    expect(IntentRunRequest.parse({ force: true }).force).toBe(true);
    expect(IntentRunRequest.safeParse({ force: 'yes' }).success).toBe(false);
  });
});
