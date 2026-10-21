import { describe, expect, it } from 'vitest';
import { getBlastRadius } from '../src/tools/get-blast-radius.js';
import { getConventions } from '../src/tools/get-conventions.js';
import { getFindings } from '../src/tools/get-findings.js';
import { listAgents } from '../src/tools/list-agents.js';
import { runAgentOnPr } from '../src/tools/run-agent-on-pr.js';
import { AGENT, AGENT2, PR, REPO, RUN, finding, makeDeps, review, textOf, type Handler } from './helpers.js';

/** Loose view of structuredContent for assertions (values are checked, the output schemas are tested in server.test.ts). */
type Item = { [key: string]: unknown; id: string; review_id: string; state: string; findings: Item[] };
type Structured = { [key: string]: unknown; agents: Item[]; reviews: Item[]; conventions: Item[]; review: Item };
const sc = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Structured;

describe('list_agents', () => {
  const agents = [
    { id: 'a1', name: 'One', enabled: true, system_prompt: 'TOP SECRET PROMPT', description: 'd'.repeat(1000), model: 'm', provider: 'p' },
    { id: 'a2', name: 'Two', enabled: false, systemPrompt: 'TOP SECRET PROMPT' },
  ];
  const handler: Handler = () => ({ body: agents });

  it('returns all agents, never the system prompt, clips description', async () => {
    const { deps, calls } = makeDeps(handler);
    const r = await listAgents(deps, {});
    expect(calls.map((c) => c.path)).toEqual(['/agents']);
    expect(sc(r).count).toBe(2);
    expect(JSON.stringify(r)).not.toContain('TOP SECRET');
    expect(Object.keys(sc(r).agents[0]!)).not.toContain('system_prompt');
    expect(sc(r).agents[0]!.description).toHaveLength(300);
    expect(sc(r).agents[1]).toMatchObject({ description: null, model: null });
  });

  it('returns exactly id, name, description, model, enabled (no provider)', async () => {
    const withExtras = [{ ...agents[0], strategy: 'single', skill_count: 3 }];
    const { deps } = makeDeps(() => ({ body: withExtras }));
    const r = await listAgents(deps, {});
    expect(Object.keys(sc(r).agents[0]!)).toEqual(['id', 'name', 'description', 'model', 'enabled']);
    expect(JSON.stringify(sc(r))).not.toContain('provider');
    expect(textOf(r)).toContain('model m');
    expect(textOf(r)).not.toContain('p/m');
  });

  it('filters enabled_only', async () => {
    const { deps } = makeDeps(handler);
    const r = await listAgents(deps, { enabled_only: true });
    expect(sc(r).agents.map((a) => a.id)).toEqual(['a1']);
  });

  it('reports an empty list', async () => {
    const { deps } = makeDeps(() => ({ body: [] }));
    const r = await listAgents(deps, {});
    expect(textOf(r)).toBe('No agents found.');
    expect(sc(r).count).toBe(0);
  });

  it('returns isError on API failure', async () => {
    const { deps } = makeDeps(() => ({ status: 500, body: { error: { code: 'E', message: 'x' } } }));
    const r = await listAgents(deps, {});
    expect(r.isError).toBe(true);
  });
});

describe('run_agent_on_pr', () => {
  function scenario(opts: {
    runStatuses: Array<Record<string, unknown>>;
    reviews?: unknown[];
    started?: unknown;
    config?: Parameters<typeof makeDeps>[1];
  }) {
    let polls = 0;
    const handler: Handler = (c) => {
      if (c.method === 'POST') {
        return { body: opts.started ?? { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT, agent_name: 'Bug hunter' }] } };
      }
      if (c.path === `/pulls/${PR}/runs`) {
        const entry = opts.runStatuses[Math.min(polls, opts.runStatuses.length - 1)]!;
        polls++;
        return { body: [{ run_id: 'other', status: 'done' }, { run_id: RUN, agent_id: AGENT, ...entry }] };
      }
      if (c.path === `/pulls/${PR}/reviews`) return { body: opts.reviews ?? [] };
      return { status: 404 };
    };
    return makeDeps(handler, opts.config);
  }

  it('POSTs exactly {agentId}, polls until done, returns the matching review', async () => {
    const { deps, calls, sleeps } = scenario({
      runStatuses: [{ status: 'running' }, { status: 'running' }, { status: 'done', duration_ms: 1234, cost_usd: 0.02 }],
      reviews: [
        review({ id: 'other', run_id: 'other-run', verdict: 'approve' }),
        review({ id: 'mine', findings: [finding({ id: 'x', severity: 'CRITICAL' })] }),
      ],
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    const post = calls.filter((c) => c.method === 'POST');
    expect(post).toHaveLength(1);
    expect(post[0]).toMatchObject({ path: `/pulls/${PR}/review`, body: { agentId: AGENT } });
    expect(sleeps).toEqual([3000, 3000]);
    expect(calls.filter((c) => c.path.endsWith('/runs'))).toHaveLength(3);
    expect(r.isError).toBeUndefined();
    expect(sc(r)).toMatchObject({ status: 'done', run_id: RUN, error: null, duration_ms: 1234, cost_usd: 0.02, agent_name: 'Bug hunter' });
    expect(sc(r).review.review_id).toBe('mine');
    expect(sc(r).review.findings).toHaveLength(1);
    expect(textOf(r)).toContain('done');
  });

  it.each(['failed', 'cancelled'])('reports %s with a sanitized error and no review', async (status) => {
    const { deps, calls } = scenario({
      runStatuses: [{ status, error: 'LLM said no, key sk-abcdefgh12345678 and ghp_secret123' }],
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(sc(r).status).toBe(status);
    expect(sc(r).review).toBeNull();
    expect(sc(r).error).toContain('LLM said no');
    expect(sc(r).error).not.toContain('sk-abcdefgh');
    expect(sc(r).error).not.toContain('ghp_secret123');
    expect(calls.some((c) => c.path.endsWith('/reviews'))).toBe(false);
  });

  it('treats an unknown status as failed', async () => {
    const { deps, sleeps } = scenario({ runStatuses: [{ status: 'exploded' }] });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(sc(r).status).toBe('failed');
    expect(sc(r).error).toContain('unknown run status');
    expect(sleeps).toEqual([]);
  });

  it('done but review missing gives review null', async () => {
    const { deps } = scenario({ runStatuses: [{ status: 'done' }], reviews: [review({ run_id: 'zzz' })] });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(sc(r).status).toBe('done');
    expect(sc(r).review).toBeNull();
  });

  it('times out (DEVDIGEST_RUN_TIMEOUT_MS) with run_id and stops polling', async () => {
    const { deps, calls, sleeps } = scenario({ runStatuses: [{ status: 'running' }], config: { runTimeoutMs: 10_000 } });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBeUndefined();
    expect(sc(r)).toMatchObject({ status: 'timeout', run_id: RUN, review: null });
    expect(sleeps).toEqual([3000, 3000, 3000]);
    const runPolls = calls.filter((c) => c.path.endsWith('/runs')).length;
    expect(runPolls).toBe(4);
    expect(calls.some((c) => c.path.endsWith('/reviews'))).toBe(false);
    expect(textOf(r)).toContain(RUN);
    expect(textOf(r)).toContain('get_findings');
  });

  it.each([
    [500, 'internal_error', 'boom'],
    [429, 'rate_limited', 'Too many requests'],
  ])('a %s while polling keeps the run_id (status poll_error, not isError)', async (status, code, message) => {
    let polls = 0;
    const { deps } = makeDeps((c) => {
      if (c.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT }] } };
      if (c.path.endsWith('/runs')) {
        polls++;
        return polls === 1 ? { body: [{ run_id: RUN, status: 'running' }] } : { status, body: { error: { code, message } } };
      }
      return { status: 404 };
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBeUndefined();
    expect(sc(r)).toMatchObject({ status: 'poll_error', run_id: RUN, review: null });
    expect(sc(r).error).toContain(String(status));
    expect(textOf(r)).toContain(RUN);
    expect(textOf(r)).toContain('get_findings');
  });

  it('a lost POST response warns that a paid run may already exist; a refused POST does not', async () => {
    const lost = makeDeps((c) => (c.method === 'POST' ? { body: { unexpected: true } } : { status: 404 }));
    const r1 = await runAgentOnPr(lost.deps, { pr_id: PR, agent_id: AGENT });
    expect(r1.isError).toBe(true);
    expect(textOf(r1)).toContain('may already have started');
    expect(textOf(r1)).toContain('get_findings');
    expect(lost.calls.filter((c) => c.method === 'POST')).toHaveLength(1); // never retried automatically

    const refused = makeDeps(() => ({ status: 404, body: { error: { code: 'not_found', message: 'Agent not found' } } }));
    const r2 = await runAgentOnPr(refused.deps, { pr_id: PR, agent_id: AGENT });
    expect(r2.isError).toBe(true);
    expect(textOf(r2)).not.toContain('may already have started');
  });

  it('a run missing from /runs (deleted) is reported as failed, without polling to the deadline', async () => {
    const { deps, sleeps } = makeDeps((c) => {
      if (c.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT }] } };
      if (c.path.endsWith('/runs')) return { body: [{ run_id: 'other', status: 'running' }] };
      return { status: 404 };
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(sc(r)).toMatchObject({ status: 'failed', run_id: RUN });
    expect(sc(r).error).toContain('not found');
    expect(sleeps).toEqual([]);
  });

  it('done but the review fetch fails: stays done with review null and the error', async () => {
    const { deps } = makeDeps((c) => {
      if (c.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT }] } };
      if (c.path.endsWith('/runs')) return { body: [{ run_id: RUN, status: 'done' }] };
      return { status: 503, body: { error: { code: 'unavailable', message: 'db down' } } };
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBeUndefined();
    expect(sc(r)).toMatchObject({ status: 'done', run_id: RUN, review: null });
    expect(sc(r).error).toContain('503');
  });

  it('reports progress on every running poll', async () => {
    const { deps } = scenario({ runStatuses: [{ status: 'running' }, { status: 'running' }, { status: 'done' }] });
    const progress: Array<[number, number, string]> = [];
    await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT }, async (p, t, m) => {
      progress.push([p, t, m]);
    });
    expect(progress).toHaveLength(2);
    expect(progress.map((x) => x[0])).toEqual([0, 3000]);
    expect(progress.every((x) => x[1] === deps.config.runTimeoutMs && x[2].includes(RUN))).toBe(true);
  });

  it('uses config.runTimeoutMs when timeout_seconds is absent', async () => {
    const { deps, sleeps } = scenario({ runStatuses: [{ status: 'running' }] });
    deps.config.runTimeoutMs = 7_000;
    await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(sleeps).toEqual([3000, 3000]);
  });

  it('returns isError when the API returns 0 runs', async () => {
    const { deps, calls } = scenario({ runStatuses: [{ status: 'done' }], started: { pr_id: PR, runs: [] } });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/runs'))).toBe(false);
  });

  it('returns isError when the API returns 2 runs', async () => {
    const { deps } = scenario({
      runStatuses: [{ status: 'done' }],
      started: {
        pr_id: PR,
        runs: [
          { run_id: RUN, agent_id: AGENT },
          { run_id: 'r2', agent_id: AGENT2 },
        ],
      },
    });
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBe(true);
  });

  it('returns isError when the single run belongs to another agent', async () => {
    const { deps } = scenario({
      runStatuses: [{ status: 'done' }],
      started: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT2 }] },
    });
    expect((await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT })).isError).toBe(true);
  });

  it.each([
    [429, 'RATE_LIMITED', 'Too many requests'],
    [404, 'NOT_FOUND', 'PR not found'],
  ])('maps POST %i to isError with a message and no stack', async (status, code, message) => {
    const { deps, calls } = makeDeps(() => ({ status, body: { error: { code, message } } }));
    const r = await runAgentOnPr(deps, { pr_id: PR, agent_id: AGENT });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain(String(status));
    expect(textOf(r)).toContain(message);
    expect(textOf(r)).not.toMatch(/\n\s+at /);
    expect(r.structuredContent).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe('get_findings', () => {
  const r1 = review({ id: 'r1', agent_id: AGENT, run_id: RUN, created_at: '2026-01-01T00:00:00Z' });
  const r2 = review({ id: 'r2', agent_id: AGENT, run_id: 'run-new', created_at: '2026-02-01T00:00:00Z' });
  const r3 = review({ id: 'r3', agent_id: AGENT2, run_id: 'run-3', created_at: '2026-01-15T00:00:00Z' });
  const summaryOnly = review({ id: 's1', agent_id: AGENT2, run_id: 'run-s', kind: 'summary', created_at: '2026-03-01T00:00:00Z' });
  const reviews = [summaryOnly, r2, r3, r1];

  const withRuns = (runs: unknown[] = []): Handler => (c) =>
    c.path.endsWith('/reviews') ? { body: reviews } : c.path.endsWith('/runs') ? { body: runs } : { status: 404 };

  it('default: latest review per agent, ignoring kind summary', async () => {
    const { deps, calls } = makeDeps(withRuns());
    const r = await getFindings(deps, { pr_id: PR });
    expect(sc(r).selection).toBe('latest_per_agent');
    expect(sc(r).truncated).toBe(false);
    expect(sc(r).reviews.map((x) => x.review_id).sort()).toEqual(['r2', 'r3']);
    expect(calls.map((c) => c.path)).toEqual([`/pulls/${PR}/reviews`]);
  });

  it('all_runs: every completed review, newest first (summaries excluded)', async () => {
    const { deps } = makeDeps(withRuns());
    const r = await getFindings(deps, { pr_id: PR, all_runs: true });
    expect(sc(r).selection).toBe('all_runs');
    expect(sc(r).reviews.map((x) => x.review_id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('no reviews at all gives a friendly text', async () => {
    const { deps } = makeDeps(() => ({ body: [] }));
    const r = await getFindings(deps, { pr_id: PR });
    expect(textOf(r)).toBe('No completed reviews found for this PR.');
  });

  it('sorts findings CRITICAL, WARNING, SUGGESTION and maps state', async () => {
    const rv = review({
      findings: [
        finding({ id: 'sug', severity: 'SUGGESTION' }),
        finding({ id: 'warn', severity: 'WARNING', accepted_at: '2026-01-01' }),
        finding({ id: 'crit', severity: 'CRITICAL', dismissed_at: '2026-01-01' }),
        finding({ id: 'crit2', severity: 'CRITICAL', file: '0.ts' }),
      ],
    });
    const { deps } = makeDeps(() => ({ body: [rv] }));
    const r = await getFindings(deps, { pr_id: PR });
    const fs = sc(r).reviews[0]!.findings;
    expect(fs.map((f) => f.id)).toEqual(['crit2', 'crit', 'warn', 'sug']);
    expect(fs.map((f) => f.state)).toEqual(['open', 'dismissed', 'accepted', 'open']);
    expect(sc(r).reviews[0]!.severity_counts).toEqual({ SUGGESTION: 1, WARNING: 1, CRITICAL: 2 });
  });

  it('truncates at 50 findings and says so', async () => {
    const many = Array.from({ length: 55 }, (_, i) => finding({ id: `f${i}`, start_line: i }));
    const { deps } = makeDeps(() => ({ body: [review({ findings: many })] }));
    const r = await getFindings(deps, { pr_id: PR });
    const out = sc(r).reviews[0]!;
    expect(out.findings).toHaveLength(50);
    expect(out.findings_total).toBe(55);
    expect(out.findings_truncated).toBe(true);
    expect(textOf(r)).toContain('5 more not shown');
  });

  it('total_findings counts findings beyond the per-review cap', async () => {
    const many = Array.from({ length: 55 }, (_, i) => finding({ id: `f${i}`, start_line: i }));
    const other = review({ id: 'r9', agent_id: AGENT2, findings: [finding({ id: 'x1' }), finding({ id: 'x2' })] });
    const { deps } = makeDeps(() => ({ body: [review({ findings: many }), other] }));
    const r = await getFindings(deps, { pr_id: PR });
    expect(sc(r).total_findings).toBe(57);
    expect(sc(r).reviews.flatMap((x) => x.findings)).toHaveLength(52);
    expect(textOf(r)).toContain('Total findings: 57');
  });

  it('total_findings covers only the selected reviews (latest per agent by default)', async () => {
    const older = review({ id: 'old', created_at: '2026-01-01T00:00:00Z', findings: [finding(), finding({ id: 'f2' })] });
    const newer = review({ id: 'new', created_at: '2026-02-01T00:00:00Z', findings: [finding()] });
    const { deps } = makeDeps(() => ({ body: [older, newer] }));
    expect(sc(await getFindings(deps, { pr_id: PR })).total_findings).toBe(1);
    expect(sc(await getFindings(deps, { pr_id: PR, all_runs: true })).total_findings).toBe(3);
  });

  it('total_findings is 0 when there are no reviews', async () => {
    const { deps } = makeDeps(() => ({ body: [] }));
    expect(sc(await getFindings(deps, { pr_id: PR })).total_findings).toBe(0);
  });

  it('does not flag truncation at exactly 50', async () => {
    const many = Array.from({ length: 50 }, (_, i) => finding({ id: `f${i}`, start_line: i }));
    const { deps } = makeDeps(() => ({ body: [review({ findings: many })] }));
    const out = sc(await getFindings(deps, { pr_id: PR })).reviews[0]!;
    expect(out.findings_truncated).toBe(false);
  });

  it('clips long rationale and suggestion', async () => {
    const rv = review({ findings: [finding({ rationale: 'r'.repeat(900), suggestion: 's'.repeat(900) })] });
    const { deps } = makeDeps(() => ({ body: [rv] }));
    const f = sc(await getFindings(deps, { pr_id: PR })).reviews[0]!.findings[0]!;
    expect(f.rationale).toHaveLength(500);
    expect(f.suggestion).toHaveLength(500);
  });

  it('returns isError on 404', async () => {
    const { deps } = makeDeps(() => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'no pr' } } }));
    const r = await getFindings(deps, { pr_id: PR });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('no pr');
  });
});

describe('get_conventions', () => {
  const state = {
    scan: { status: 'done', model: 'm', started_at: 's', finished_at: 'f' },
    candidates: [
      { id: 'c1', rule: 'Use X', category: 'style', status: 'accepted', confidence: 0.9, evidence_path: 'a.ts', evidence_line: 3 },
      { id: 'c2', rule: 'Pending', category: 'style', status: 'pending' },
      { id: 'c3', rule: 'Rejected', category: 'style', status: 'rejected' },
    ],
    counts: { pending: 1, accepted: 1, rejected: 1 },
    source: { repo_full_name: 'o/r', ref: 'main' },
  };
  const handler: Handler = () => ({ body: state });
  const ids = (r: Parameters<typeof sc>[0]) => sc(r).conventions.map((c) => c.id);

  it('defaults to accepted and omits include_rejected', async () => {
    const { deps, calls } = makeDeps(handler);
    const r = await getConventions(deps, { repo_id: REPO });
    expect(ids(r)).toEqual(['c1']);
    expect(calls[0]!.path).toBe(`/repos/${REPO}/conventions?include_rejected=false`);
    expect(sc(r)).toMatchObject({ repo_full_name: 'o/r', ref: 'main', truncated: false });
    expect(sc(r).last_scan).toEqual({ status: 'done', model: 'm', finished_at: 'f' });
    expect(sc(r).conventions[0]).toMatchObject({ evidence_path: 'a.ts', evidence_line: 3, confidence: 0.9 });
  });

  it('pending: include_rejected=false', async () => {
    const { deps, calls } = makeDeps(handler);
    expect(ids(await getConventions(deps, { repo_id: REPO, status: 'pending' }))).toEqual(['c2']);
    expect(calls[0]!.path).toContain('include_rejected=false');
  });

  it('rejected: include_rejected=true', async () => {
    const { deps, calls } = makeDeps(handler);
    expect(ids(await getConventions(deps, { repo_id: REPO, status: 'rejected' }))).toEqual(['c3']);
    expect(calls[0]!.path).toContain('include_rejected=true');
  });

  it('all: include_rejected=true and everything returned', async () => {
    const { deps, calls } = makeDeps(handler);
    expect(ids(await getConventions(deps, { repo_id: REPO, status: 'all' }))).toEqual(['c1', 'c2', 'c3']);
    expect(calls[0]!.path).toContain('include_rejected=true');
  });

  it('truncates at 100 and sets truncated', async () => {
    const candidates = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, rule: 'r', category: 'k', status: 'accepted' }));
    const { deps } = makeDeps(() => ({ body: { ...state, candidates } }));
    const r = await getConventions(deps, { repo_id: REPO });
    expect(sc(r).conventions).toHaveLength(100);
    expect(sc(r).truncated).toBe(true);
  });

  it('exactly 100 is not truncated', async () => {
    const candidates = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, rule: 'r', category: 'k', status: 'accepted' }));
    const { deps } = makeDeps(() => ({ body: { ...state, candidates } }));
    expect(sc(await getConventions(deps, { repo_id: REPO })).truncated).toBe(false);
  });

  it('no scan: last_scan null and a note in the text', async () => {
    const { deps } = makeDeps(() => ({ body: { ...state, scan: null, candidates: [] } }));
    const r = await getConventions(deps, { repo_id: REPO });
    expect(sc(r).last_scan).toBeNull();
    expect(textOf(r)).toContain('No conventions scan has been run');
  });

  it('returns isError for an invalid response shape', async () => {
    const { deps } = makeDeps(() => ({ body: { nope: true } }));
    const r = await getConventions(deps, { repo_id: REPO });
    expect(r.isError).toBe(true);
  });
});

describe('get_blast_radius', () => {
  const SHA = '45ce6b9adc1dbc433275cb6d79b8bc6000f127dd';
  const blob = (file: string, line: number) => `https://github.com/o/r/blob/${SHA}/${file}#L${line}`;
  const blast = (over: Record<string, unknown> = {}) => ({
    changed_symbols: [{ name: 'toDto', file: 'src/helpers.ts', kind: 'function', line: 3, url: blob('src/helpers.ts', 3) }],
    downstream: [
      {
        symbol: 'toDto',
        file: 'src/helpers.ts',
        callers: [
          { name: 'list', file: 'src/service.ts', line: 12, url: blob('src/service.ts', 12) },
          { name: 'runSync', file: 'src/jobs/worker.ts', line: 4, url: blob('src/jobs/worker.ts', 4) },
        ],
        caller_count: 2,
        truncated: false,
        endpoints_affected: ['GET /items', 'POST /items'],
        crons_affected: ['job:sync'],
      },
    ],
    summary: '1 changed symbol, 2 callers; potentially affected: 2 endpoints, 1 cron/job.',
    totals: { symbols: 1, callers: 2, endpoints: 2, crons: 1 },
    degraded: false,
    reason: null,
    source: { repo_full_name: 'o/r', ref: SHA },
    ...over,
  });
  type Blast = { [k: string]: unknown; downstream: Item[]; changed_symbols: Item[]; totals: Record<string, number> };
  const b = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Blast;
  const notFound: Handler = () => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Pull request not found' } } });

  it('GETs /pulls/:id/blast once and returns the BlastRadius contract with callers, endpoints and crons', async () => {
    const { deps, calls } = makeDeps(() => ({ body: blast() }));
    const r = await getBlastRadius(deps, { pr_id: PR });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /pulls/${PR}/blast`]);
    expect(r.isError).toBeUndefined();
    expect(b(r)).toMatchObject({
      pr_id: PR,
      degraded: false,
      reason: null,
      source: { repo_full_name: 'o/r', ref: SHA },
      totals: { symbols: 1, callers: 2, endpoints: 2, crons: 1 },
      symbols_truncated: false,
    });
    expect(b(r).downstream[0]).toMatchObject({
      symbol: 'toDto',
      caller_count: 2,
      truncated: false,
      endpoints_affected: ['GET /items', 'POST /items'],
      crons_affected: ['job:sync'],
    });
    expect(b(r).downstream[0]!.callers).toContainEqual({ name: 'list', file: 'src/service.ts', line: 12, url: blob('src/service.ts', 12) });
    const text = textOf(r);
    expect(text).toContain('src/service.ts:12 (list)');
    expect(text).toContain('potentially affected endpoints: GET /items, POST /items');
    expect(text).toContain(`o/r@${SHA.slice(0, 7)}`);
    expect(text).toContain('may differ from the PR head');
  });

  it('empty result: no changed symbols, not degraded', async () => {
    const empty = blast({
      changed_symbols: [],
      downstream: [],
      summary: 'No changed symbols found in the indexed code.',
      totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    });
    const { deps } = makeDeps(() => ({ body: empty }));
    const r = await getBlastRadius(deps, { pr_id: PR });
    expect(r.isError).toBeUndefined();
    expect(b(r)).toMatchObject({ changed_symbols: [], downstream: [], degraded: false, totals: { symbols: 0, callers: 0 } });
    expect(textOf(r)).toContain('No changed symbols found');
  });

  it('degraded state: keeps the reason and says the analysis is partial', async () => {
    const degraded = blast({
      degraded: true,
      reason: 'no_files',
      changed_symbols: [],
      downstream: [],
      source: { repo_full_name: 'o/r', ref: '' },
    });
    const { deps } = makeDeps(() => ({ body: degraded }));
    const r = await getBlastRadius(deps, { pr_id: PR });
    expect(b(r)).toMatchObject({ degraded: true, reason: 'no_files' });
    expect(textOf(r)).toContain('Partial analysis (reason: no_files)');
    expect(textOf(r)).not.toContain('Source:');
  });

  it('fills fields an older API omits (no totals / degraded / source / caller_count)', async () => {
    const legacy = {
      changed_symbols: [{ name: 'a', file: 'a.ts', kind: 'function' }],
      downstream: [{ symbol: 'a', callers: [{ name: 'x', file: 'x.ts', line: 1 }], endpoints_affected: ['GET /x'], crons_affected: [] }],
      summary: 's',
    };
    const { deps } = makeDeps(() => ({ body: legacy }));
    const r = await getBlastRadius(deps, { pr_id: PR });
    expect(b(r)).toMatchObject({
      degraded: false,
      reason: null,
      source: null,
      totals: { symbols: 1, callers: 1, endpoints: 1, crons: 0 },
      changed_symbols: [{ name: 'a', line: null, url: null }],
      downstream: [{ symbol: 'a', file: null, caller_count: 1, truncated: false, callers: [{ url: null }] }],
    });
  });

  it('bounds the number of changed symbols', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ symbol: `s${i}`, callers: [], endpoints_affected: [], crons_affected: [] }));
    const syms = many.map((d) => ({ name: d.symbol, file: 'a.ts', kind: 'function' }));
    const { deps } = makeDeps(() => ({ body: blast({ changed_symbols: syms, downstream: many }) }));
    const r = await getBlastRadius(deps, { pr_id: PR });
    expect(b(r).downstream).toHaveLength(50);
    expect(b(r).changed_symbols).toHaveLength(50);
    expect(b(r).symbols_truncated).toBe(true);
    expect(textOf(r)).toContain('Only the first 50 changed symbols');
  });

  it('API errors: 404 / 500 / network / invalid shape → isError, no structured content, no stack', async () => {
    const network: Handler = () => {
      throw new TypeError('fetch failed');
    };
    for (const handler of [
      notFound,
      () => ({ status: 500, body: { error: { code: 'BOOM', message: 'x' } } }),
      network,
      () => ({ body: { nope: true } }),
    ] as Handler[]) {
      const { deps } = makeDeps(handler);
      const r = await getBlastRadius(deps, { pr_id: PR });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toBeUndefined();
      expect(textOf(r)).not.toMatch(/\n\s+at /);
    }
    const { deps } = makeDeps(notFound);
    expect(textOf(await getBlastRadius(deps, { pr_id: PR }))).toContain('Pull request not found');
  });
});
