import { describe, it, expect } from 'vitest';
import type { AgentColumn, AgentColumnFinding } from '@devdigest/shared';
import {
  UNKNOWN_AGENT_NAME,
  buildMultiAgentRun,
  groupFindings,
  isConflict,
  orderChildren,
  toColumnStatus,
  totalsOf,
  type ChildRunInput,
} from '../src/modules/reviews/multi-run/helpers.js';

/** L07 T4 — pure read model of a multi-run (AC-MAR-12..18, 53, 54). No DB. */

let seq = 0;
function finding(o: Partial<AgentColumnFinding> & Pick<AgentColumnFinding, 'file' | 'start_line'>): AgentColumnFinding {
  seq++;
  return {
    id: `f${seq}`,
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${seq}`,
    kind: 'finding',
    end_line: o.start_line,
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    review_id: 'rev',
    accepted_at: null,
    dismissed_at: null,
    eval_case_id: null,
    ...o,
  };
}

function column(n: number, findings: AgentColumnFinding[], status: AgentColumn['status'] = 'done'): AgentColumn {
  return {
    run_id: `run-${n}`,
    agent_id: `agent-${n}`,
    agent_name: `Agent ${n}`,
    provider: 'openai',
    model: 'm',
    status,
    error: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: 1000,
    cost_usd: 0.01,
    findings,
  };
}

function child(n: number, o: Partial<ChildRunInput> = {}): ChildRunInput {
  return {
    runId: `run-${n}`,
    agentId: `agent-${n}`,
    agentName: `Agent ${n}`,
    provider: 'openai',
    model: 'm',
    status: 'done',
    error: null,
    score: 70,
    durationMs: 1000,
    ranAt: new Date(Date.UTC(2026, 9, 23, 10, 0, 0, n)),
    costUsd: 0.01,
    review: { verdict: 'comment', summary: `summary ${n}`, score: 70 },
    findings: [],
    ...o,
  };
}

describe('groupFindings (AC-MAR-12..14)', () => {
  it('AC-12: same file + overlapping inclusive ranges → one group, transitively', () => {
    const a = finding({ file: 'a.ts', start_line: 10, end_line: 12 });
    const b = finding({ file: 'a.ts', start_line: 12, end_line: 15 }); // touches a at 12 (inclusive)
    const c = finding({ file: 'a.ts', start_line: 15, end_line: 20 }); // touches b only → transitive
    const groups = groupFindings([column(1, [a]), column(2, [b]), column(3, [c])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ file: 'a.ts', start_line: 10, end_line: 20 });
    expect(groups[0]!.members.map((m) => m.finding_id)).toEqual([a.id, b.id, c.id]);
  });

  it('AC-13: different files or non-overlapping ranges → separate groups', () => {
    const a = finding({ file: 'a.ts', start_line: 10, end_line: 12 });
    const gap = finding({ file: 'a.ts', start_line: 13, end_line: 14 }); // adjacent, not overlapping
    const other = finding({ file: 'b.ts', start_line: 10, end_line: 12 });
    const groups = groupFindings([column(1, [a, other]), column(2, [gap])]);
    expect(groups.map((g) => [g.file, g.start_line, g.end_line])).toEqual([
      ['a.ts', 10, 12],
      ['a.ts', 13, 14],
      ['b.ts', 10, 12],
    ]);
  });

  it('AC-14: every finding appears exactly once with its run/agent attribution; input is not mutated', () => {
    const fs = [
      finding({ file: 'a.ts', start_line: 1, end_line: 5 }),
      finding({ file: 'a.ts', start_line: 3, end_line: 4 }),
      finding({ file: 'a.ts', start_line: 30 }),
      finding({ file: 'c.ts', start_line: 2 }),
    ];
    const cols = [column(1, [fs[0]!, fs[2]!]), column(2, [fs[1]!, fs[3]!])];
    const snapshot = JSON.stringify(cols);
    const groups = groupFindings(cols);
    const ids = groups.flatMap((g) => g.members.map((m) => m.finding_id)).sort();
    expect(ids).toEqual(fs.map((f) => f.id).sort());
    const m = groups.flatMap((g) => g.members).find((x) => x.finding_id === fs[1]!.id)!;
    expect(m).toEqual({
      finding_id: fs[1]!.id,
      run_id: 'run-2',
      agent_id: 'agent-2',
      agent_name: 'Agent 2',
      severity: fs[1]!.severity,
      title: fs[1]!.title,
    });
    expect(JSON.stringify(cols)).toBe(snapshot);
  });

  it('group title = highest-severity member, ties by column order', () => {
    const groups = groupFindings([
      column(1, [finding({ file: 'a.ts', start_line: 1, severity: 'WARNING', title: 'w1' })]),
      column(2, [finding({ file: 'a.ts', start_line: 1, severity: 'CRITICAL', title: 'crit' })]),
      column(3, [finding({ file: 'a.ts', start_line: 1, severity: 'CRITICAL', title: 'crit-later' })]),
    ]);
    expect(groups[0]!.title).toBe('crit');
  });
});

describe('takes and conflicts (AC-MAR-15, 16, 54)', () => {
  it('AC-16: one take per column — severity+title, ignored (empty note), no_result for failed/cancelled/running', () => {
    const cols = [
      column(1, [
        finding({ file: 'a.ts', start_line: 5, end_line: 6, severity: 'SUGGESTION', title: 'minor' }),
        finding({ file: 'a.ts', start_line: 6, severity: 'CRITICAL', title: 'the big one' }),
      ]),
      column(2, []),
      column(3, [], 'failed'),
      column(4, [], 'cancelled'),
      column(5, [], 'running'),
    ];
    const [group] = groupFindings(cols);
    expect(group!.takes).toEqual([
      { agent_id: 'agent-1', persona: 'Agent 1', verdict: 'CRITICAL', note: 'the big one' },
      { agent_id: 'agent-2', persona: 'Agent 2', verdict: 'ignored', note: '' },
      { agent_id: 'agent-3', persona: 'Agent 3', verdict: 'no_result', note: '' },
      { agent_id: 'agent-4', persona: 'Agent 4', verdict: 'no_result', note: '' },
      { agent_id: 'agent-5', persona: 'Agent 5', verdict: 'no_result', note: '' },
    ]);
  });

  it('AC-16: non-conflict groups get takes too (flagged by every done agent, same severity)', () => {
    const cols = [
      column(1, [finding({ file: 'a.ts', start_line: 1, severity: 'WARNING' })]),
      column(2, [finding({ file: 'a.ts', start_line: 1, severity: 'WARNING' })]),
    ];
    const [group] = groupFindings(cols);
    expect(group!.takes.map((t) => t.verdict)).toEqual(['WARNING', 'WARNING']);
    expect(isConflict(group!, cols)).toBe(false);
  });

  it('AC-15: conflict when one done agent flagged and another done agent did not', () => {
    const cols = [column(1, [finding({ file: 'a.ts', start_line: 1 })]), column(2, [])];
    expect(isConflict(groupFindings(cols)[0]!, cols)).toBe(true);
  });

  it('AC-15: conflict when flagging agents disagree on the highest severity', () => {
    const cols = [
      column(1, [finding({ file: 'a.ts', start_line: 1, severity: 'WARNING' })]),
      column(2, [finding({ file: 'a.ts', start_line: 1, severity: 'CRITICAL' })]),
    ];
    expect(isConflict(groupFindings(cols)[0]!, cols)).toBe(true);
  });

  it('AC-15: not a conflict when the only other agents have no result (failed/running)', () => {
    const cols = [column(1, [finding({ file: 'a.ts', start_line: 1 })]), column(2, [], 'failed'), column(3, [], 'running')];
    expect(isConflict(groupFindings(cols)[0]!, cols)).toBe(false);
  });
});

describe('totals (AC-MAR-17, 18)', () => {
  it('AC-17: sum of known costs; cost_partial when a done child cost is unknown', () => {
    expect(totalsOf([child(1, { costUsd: 0.01 }), child(2, { costUsd: 0.02 })])).toMatchObject({
      total_cost_usd: 0.03,
      cost_partial: false,
    });
    expect(totalsOf([child(1, { costUsd: 0.01 }), child(2, { costUsd: null })])).toMatchObject({
      total_cost_usd: 0.01,
      cost_partial: true,
    });
  });

  it('AC-17: null when no cost is known; a running child with unknown cost is not "partial"', () => {
    expect(totalsOf([child(1, { costUsd: null, status: 'running' })])).toMatchObject({
      total_cost_usd: null,
      cost_partial: false,
    });
    expect(totalsOf([child(1, { costUsd: null })])).toMatchObject({ total_cost_usd: null, cost_partial: true });
  });

  it('AC-18: wall clock over terminal children; total = sum of durations; running/unknown excluded from wall clock', () => {
    const t0 = Date.UTC(2026, 9, 23, 10, 0, 0, 0);
    const totals = totalsOf([
      child(1, { ranAt: new Date(t0), durationMs: 3000 }),
      child(2, { ranAt: new Date(t0 + 1), durationMs: 5000, status: 'failed' }),
      child(3, { ranAt: new Date(t0 + 2), durationMs: null, status: 'running' }),
      child(4, { ranAt: new Date(t0 + 3), durationMs: null, status: 'failed' }), // reaped
    ]);
    expect(totals.wall_clock_ms).toBe(5001);
    expect(totals.total_duration_ms).toBe(8000);
    expect(totalsOf([child(1, { status: 'running', durationMs: null })]).wall_clock_ms).toBeNull();
  });
});

describe('buildMultiAgentRun (AC-MAR-09, 53, partial results)', () => {
  const parent = { id: 'multi-1', prId: 'pr-1', prNumber: 482, ranAt: new Date(Date.UTC(2026, 9, 23, 10)) };

  it('AC-53: columns ordered by ran_at, then run id, regardless of input order', () => {
    const t0 = Date.UTC(2026, 9, 23, 10);
    const shuffled = [
      child(3, { ranAt: new Date(t0 + 2) }),
      child(1, { runId: 'run-b', ranAt: new Date(t0) }),
      child(2, { runId: 'run-a', ranAt: new Date(t0) }), // same ran_at → run id breaks the tie
    ];
    expect(orderChildren(shuffled).map((c) => c.runId)).toEqual(['run-a', 'run-b', 'run-3']);
    expect(buildMultiAgentRun(parent, shuffled).columns.map((c) => c.run_id)).toEqual(['run-a', 'run-b', 'run-3']);
  });

  it('builds the full read model with columns, groups, conflicts and totals', () => {
    const shared = finding({ file: 'src/rate.ts', start_line: 28, severity: 'SUGGESTION', title: 'Magic number' });
    const run = buildMultiAgentRun(parent, [
      child(1, { findings: [shared] }),
      child(2, { findings: [] }),
      child(3, { status: 'failed', error: 'provider down', review: null, score: null, costUsd: null }),
    ]);
    expect(run).toMatchObject({
      id: 'multi-1',
      pr_id: 'pr-1',
      pr_number: 482,
      ran_at: parent.ranAt.toISOString(),
      agent_count: 3,
      total_cost_usd: 0.02,
      cost_partial: false, // the unknown cost belongs to a failed child
    });
    expect(run.columns[0]).toMatchObject({ status: 'done', verdict: 'comment', summary: 'summary 1', score: 70 });
    expect(run.columns[2]).toMatchObject({ status: 'failed', error: 'provider down', verdict: null, findings: [] });
    expect(run.groups).toHaveLength(1);
    expect(run.conflicts).toHaveLength(1);
    expect(run.conflicts[0]).toMatchObject({ file: 'src/rate.ts', line: 28, start_line: 28, end_line: 28, title: 'Magic number' });
    expect(run.conflicts[0]!.takes.map((t) => t.verdict)).toEqual(['SUGGESTION', 'ignored', 'no_result']);
  });

  it('partial results: while agents still run, done columns show findings and running ones are no_result', () => {
    const run = buildMultiAgentRun(parent, [
      child(1, { findings: [finding({ file: 'a.ts', start_line: 1, severity: 'CRITICAL' })] }),
      child(2, { status: 'running', durationMs: null, costUsd: null, review: null, score: null }),
    ]);
    expect(run.columns.map((c) => c.status)).toEqual(['done', 'running']);
    expect(run.groups[0]!.takes.map((t) => t.verdict)).toEqual(['CRITICAL', 'no_result']);
    expect(run.conflicts).toHaveLength(0); // nobody done disagrees yet
    expect(run.wall_clock_ms).toBe(1000);
  });

  it('a deleted agent keeps its column under a placeholder name; an empty multi-run has no groups', () => {
    const run = buildMultiAgentRun(parent, [child(1, { agentId: null, agentName: null })]);
    expect(run.columns[0]).toMatchObject({ agent_id: '', agent_name: UNKNOWN_AGENT_NAME });
    const empty = buildMultiAgentRun(parent, []);
    expect(empty).toMatchObject({ agent_count: 0, columns: [], groups: [], conflicts: [], wall_clock_ms: null, total_cost_usd: null });
  });

  it('unknown run statuses read as failed', () => {
    expect(toColumnStatus(null)).toBe('failed');
    expect(toColumnStatus('weird')).toBe('failed');
    expect(toColumnStatus('cancelled')).toBe('cancelled');
  });
});
