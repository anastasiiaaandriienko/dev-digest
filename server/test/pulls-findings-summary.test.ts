import { describe, it, expect } from 'vitest';
import { PrMeta } from '@devdigest/shared';
import {
  buildFindingsSummaries,
  latestReviewPerAgent,
  type CandidateReview,
} from '../src/modules/pulls/findings-summary.js';

/**
 * L01 — PR-list FINDINGS across agents: selection (latest completed review per
 * agent) and counting. The SQL (completed-run filter, workspace scope) is
 * covered by pulls-findings-summary.it.test.ts.
 */

const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 10, min));

function review(id: string, o: Partial<CandidateReview> = {}): CandidateReview {
  return { id, prId: 'pr1', agentId: 'a1', agentName: 'Security', verdict: 'comment', createdAt: at(0), ...o };
}

describe('latestReviewPerAgent', () => {
  it('keeps one review per agent: the newest', () => {
    const picked = latestReviewPerAgent([
      review('old', { createdAt: at(1) }),
      review('new', { createdAt: at(5) }),
      review('mid', { createdAt: at(3) }),
    ]);
    expect(picked.get('pr1')!.map((r) => r.id)).toEqual(['new']);
  });

  it('keeps every agent, newest first', () => {
    const picked = latestReviewPerAgent([
      review('a1-old', { agentId: 'a1', createdAt: at(1) }),
      review('a2', { agentId: 'a2', createdAt: at(2) }),
      review('a1-new', { agentId: 'a1', createdAt: at(3) }),
    ]);
    expect(picked.get('pr1')!.map((r) => r.id)).toEqual(['a1-new', 'a2']);
  });

  it('groups per PR, and reviews without an agent share one bucket', () => {
    const picked = latestReviewPerAgent([
      review('p1', { prId: 'pr1', agentId: null, createdAt: at(1) }),
      review('p1-newer', { prId: 'pr1', agentId: null, createdAt: at(2) }),
      review('p2', { prId: 'pr2', agentId: 'a1', createdAt: at(1) }),
    ]);
    expect(picked.get('pr1')!.map((r) => r.id)).toEqual(['p1-newer']);
    expect(picked.get('pr2')!.map((r) => r.id)).toEqual(['p2']);
  });

  it('breaks a createdAt tie deterministically (by id)', () => {
    const rows = [review('b', { createdAt: at(1) }), review('a', { createdAt: at(1) })];
    expect(latestReviewPerAgent(rows).get('pr1')![0]!.id).toBe('b');
    expect(latestReviewPerAgent([...rows].reverse()).get('pr1')![0]!.id).toBe('b');
  });

  it('no reviews → no PR entries', () => {
    expect(latestReviewPerAgent([]).size).toBe(0);
  });
});

describe('buildFindingsSummaries', () => {
  it('sums the selected reviews only, with a per-agent breakdown', () => {
    const selected = latestReviewPerAgent([
      review('sec', { agentId: 'a1', agentName: 'Security', verdict: 'request_changes', createdAt: at(3) }),
      review('sec-old', { agentId: 'a1', createdAt: at(1) }),
      review('perf', { agentId: 'a2', agentName: 'Performance', verdict: 'approve', createdAt: at(2) }),
    ]);
    const summary = buildFindingsSummaries(selected, [
      { reviewId: 'sec', severity: 'CRITICAL', count: 2 },
      { reviewId: 'sec', severity: 'WARNING', count: 1 },
      { reviewId: 'perf', severity: 'SUGGESTION', count: 3 },
      // The older Security review is not selected; its rows would not be queried,
      // and even if present they must not be counted.
      { reviewId: 'sec-old', severity: 'CRITICAL', count: 9 },
    ]).get('pr1')!;

    expect(summary.total).toBe(6);
    expect(summary.counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 3, INFO: 0 });
    expect(summary.agents).toEqual([
      {
        agent_id: 'a1',
        agent_name: 'Security',
        review_id: 'sec',
        verdict: 'request_changes',
        created_at: at(3).toISOString(),
        total: 3,
        counts: { CRITICAL: 2, WARNING: 1, SUGGESTION: 0, INFO: 0 },
      },
      {
        agent_id: 'a2',
        agent_name: 'Performance',
        review_id: 'perf',
        verdict: 'approve',
        created_at: at(2).toISOString(),
        total: 3,
        counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 3, INFO: 0 },
      },
    ]);
  });

  it('an agent with zero findings is listed with zero counts', () => {
    const summary = buildFindingsSummaries(latestReviewPerAgent([review('clean')]), []).get('pr1')!;
    expect(summary).toMatchObject({ total: 0, counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, INFO: 0 } });
    expect(summary.agents).toHaveLength(1);
    expect(summary.agents[0]).toMatchObject({ review_id: 'clean', total: 0 });
  });

  it('INFO is counted; an unknown severity still counts toward the total', () => {
    const summary = buildFindingsSummaries(latestReviewPerAgent([review('r')]), [
      { reviewId: 'r', severity: 'INFO', count: 1 },
      { reviewId: 'r', severity: 'WEIRD', count: 1 },
    ]).get('pr1')!;
    expect(summary.counts.INFO).toBe(1);
    expect(summary.total).toBe(2);
  });

  it('an unknown verdict string becomes null (contract enum)', () => {
    const summary = buildFindingsSummaries(latestReviewPerAgent([review('r', { verdict: 'maybe' })]), []);
    expect(summary.get('pr1')!.agents[0]!.verdict).toBeNull();
  });
});

describe('PrMeta.findings_summary contract', () => {
  const pr = {
    number: 1,
    title: 't',
    author: 'a',
    branch: 'b',
    base: 'main',
    head_sha: 'abc',
    additions: 0,
    deletions: 0,
    files_count: 0,
    status: 'needs_review',
  };

  it('parses a built summary, null and a missing field', () => {
    const summary = buildFindingsSummaries(latestReviewPerAgent([review('r')]), [
      { reviewId: 'r', severity: 'CRITICAL', count: 1 },
    ]).get('pr1')!;
    expect(PrMeta.parse({ ...pr, findings_summary: summary }).findings_summary).toEqual(summary);
    expect(PrMeta.parse({ ...pr, findings_summary: null }).findings_summary).toBeNull();
    expect(PrMeta.parse(pr).findings_summary).toBeUndefined();
  });
});
