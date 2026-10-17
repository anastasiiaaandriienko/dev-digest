import { describe, expect, it } from 'vitest';
import { getBlastRadius } from '../src/tools/get-blast-radius.js';
import { getFindings } from '../src/tools/get-findings.js';
import { runAgentOnPr } from '../src/tools/run-agent-on-pr.js';
import { parsePrRef } from '../src/tools/pr-ref.js';
import { AGENT, AGENT2, PR, RUN, makeDeps, review, textOf, type Call, type Handler } from './helpers.js';

/**
 * One `pr_id` string — uuid, PR number ("3" / "#3") or part of the title — plus an
 * optional `repo`, for get_blast_radius, get_findings and run_agent_on_pr. Numbers and
 * titles go through GET /pulls (stored PRs only); exactly one match is used, anything
 * else is an error — never a guess.
 */

const PR2 = '66666666-6666-4666-8666-666666666666';
const ref = (over: Record<string, unknown> = {}) => ({
  id: PR,
  number: 3,
  title: '[DO NOT MERGE] Test: API contract changes',
  status: 'open',
  repo_id: 'r1',
  repo_full_name: 'o/r',
  ...over,
});
const ONE_REPO = [{ id: 'r1', full_name: 'o/r' }];
const lookup = (matches: unknown[], o: { repo_matches?: unknown[] | null; truncated?: boolean } = {}) => ({
  matches,
  truncated: o.truncated ?? false,
  repo_matches: o.repo_matches ?? null,
});
const BLAST = {
  changed_symbols: [],
  downstream: [],
  summary: 'No changed symbols found in the indexed code.',
  totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
  degraded: false,
  reason: null,
  source: { repo_full_name: 'o/r', ref: 'abc1234' },
};

/** GET /pulls?… answers `found`; GET /pulls/:id/blast answers BLAST. */
function blastHandler(found: unknown): Handler {
  return (c: Call) => {
    if (c.path.startsWith('/pulls?')) return { body: found };
    if (c.path.endsWith('/blast')) return { body: BLAST };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
  };
}
const paths = (calls: Call[]) => calls.map((c) => `${c.method} ${c.path}`);
const sc = (r: { structuredContent?: Record<string, unknown> }) => r.structuredContent as Record<string, unknown>;

describe('parsePrRef', () => {
  it('reads a uuid, a number with or without #, or a title (trimmed)', () => {
    expect(parsePrRef(PR)).toEqual({ uuid: PR });
    expect(parsePrRef('18')).toEqual({ number: 18 });
    expect(parsePrRef(' #18 ')).toEqual({ number: 18 });
    expect(parsePrRef('cost tracking')).toEqual({ title: 'cost tracking' });
    expect(parsePrRef('#abc')).toEqual({ title: '#abc' });
  });

  it('rejects an empty value, a 1-character title, PR number 0 and an over-long title', () => {
    for (const bad of ['', '  ', 'x', '0', '#0', 'y'.repeat(201)]) expect(() => parsePrRef(bad), bad).toThrow();
  });
});

describe('PR reference — get_blast_radius', () => {
  it('a uuid works as before: no lookup call (repo does not apply to it)', async () => {
    const { deps, calls } = makeDeps(blastHandler(lookup([])));
    const r = await getBlastRadius(deps, { pr_id: PR, repo: 'ignored/repo' });
    expect(r.isError).toBeUndefined();
    expect(paths(calls)).toEqual([`GET /pulls/${PR}/blast`]);
    expect(textOf(r)).not.toContain('Resolved PR');
  });

  it('"#3" or "3" + repo resolves the one stored PR and says which one', async () => {
    for (const prId of ['#3', '3']) {
      const { deps, calls } = makeDeps(blastHandler(lookup([ref()], { repo_matches: ONE_REPO })));
      const r = await getBlastRadius(deps, { pr_id: prId, repo: 'o/r' });
      expect(r.isError, prId).toBeUndefined();
      expect(paths(calls)).toEqual(['GET /pulls?number=3&repo=o%2Fr', `GET /pulls/${PR}/blast`]);
      expect(sc(r).pr_id).toBe(PR);
      expect(textOf(r)).toContain(`Resolved PR #3 in o/r (pr_id ${PR}).`);
    }
  });

  it('a number without repo works when it is unique', async () => {
    const { deps, calls } = makeDeps(blastHandler(lookup([ref()])));
    const r = await getBlastRadius(deps, { pr_id: '3' });
    expect(r.isError).toBeUndefined();
    expect(paths(calls)[0]).toBe('GET /pulls?number=3');
  });

  it('a number stored in several repositories is an error listing them — no blast call', async () => {
    const both = lookup([ref(), ref({ id: PR2, repo_id: 'r2', repo_full_name: 'acme/api', title: 'Other' })]);
    const { deps, calls } = makeDeps(blastHandler(both));
    const r = await getBlastRadius(deps, { pr_id: '#3' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('PR #3 is ambiguous: 2 stored PRs match. Pass repo, or the pr_id uuid:');
    expect(textOf(r)).toContain(`- o/r#3 "[DO NOT MERGE] Test: API contract changes" (pr_id ${PR})`);
    expect(textOf(r)).toContain(`- acme/api#3 "Other" (pr_id ${PR2})`);
    expect(paths(calls)).toEqual(['GET /pulls?number=3']);
  });

  it('part of the title: one match resolves it; several are listed (bounded), none is picked', async () => {
    const single = makeDeps(blastHandler(lookup([ref({ number: 5, title: 'test: add skill budget helpers' })])));
    const ok = await getBlastRadius(single.deps, { pr_id: 'skill budget' });
    expect(paths(single.calls)[0]).toBe('GET /pulls?title=skill+budget');
    expect(textOf(ok)).toContain('Resolved PR #5 in o/r');

    const many = Array.from({ length: 12 }, (_, i) => ref({ id: `id-${i}`, number: 100 + i, title: `L0${i} lab` }));
    const multi = makeDeps(blastHandler(lookup(many, { truncated: true })));
    const r = await getBlastRadius(multi.deps, { pr_id: 'L0' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('A PR with "L0" in its title is ambiguous: 12+ stored PRs match');
    expect(textOf(r).match(/^- o\/r#/gm)).toHaveLength(10);
    expect(textOf(r)).toContain('- …');
    expect(multi.calls).toHaveLength(1);
  });

  it('not found, unknown repo and ambiguous short repo name are clear errors', async () => {
    const missing = makeDeps(blastHandler(lookup([], { repo_matches: ONE_REPO })));
    expect(textOf(await getBlastRadius(missing.deps, { pr_id: '9999', repo: 'o/r' }))).toBe(
      'PR #9999 in o/r was not found among the PRs stored in DevDigest (it may not be imported yet).',
    );

    const none = makeDeps(blastHandler(lookup([], { repo_matches: [] })));
    expect(textOf(await getBlastRadius(none.deps, { pr_id: '3', repo: 'nope' }))).toBe('Repository "nope" is not in DevDigest.');

    const two = makeDeps(
      blastHandler(lookup([ref()], { repo_matches: [{ id: 'r1', full_name: 'a/dev-digest' }, { id: 'r2', full_name: 'b/dev-digest' }] })),
    );
    const r = await getBlastRadius(two.deps, { pr_id: '3', repo: 'dev-digest' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe('Repository "dev-digest" is ambiguous: a/dev-digest, b/dev-digest. Pass repo as "owner/name".');
  });

  it('an invalid pr_id is an error without any API call', async () => {
    const { deps, calls } = makeDeps(blastHandler(lookup([])));
    for (const bad of ['', 'x', '#0']) expect((await getBlastRadius(deps, { pr_id: bad })).isError, bad).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('a lookup API failure is an isError result', async () => {
    const { deps } = makeDeps(() => ({ status: 500, body: { error: { code: 'BOOM', message: 'x' } } }));
    const r = await getBlastRadius(deps, { pr_id: '3' });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('GET /pulls?number=3');
  });
});

describe('PR reference — run_agent_on_pr (paid) never starts on an unresolved PR', () => {
  it('ambiguous or unknown PR → error and NO POST', async () => {
    for (const found of [lookup([ref(), ref({ id: PR2, repo_full_name: 'acme/api' })]), lookup([])]) {
      const { deps, calls } = makeDeps((c) => (c.path.startsWith('/pulls?') ? { body: found } : { status: 500 }));
      const r = await runAgentOnPr(deps, { pr_id: '#3', agent_id: AGENT });
      expect(r.isError).toBe(true);
      expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    }
  });

  it('a resolved number starts the run on the resolved pr_id (fake fetch, no real review)', async () => {
    const { deps, calls } = makeDeps((c) => {
      if (c.path.startsWith('/pulls?')) return { body: lookup([ref()], { repo_matches: ONE_REPO }) };
      if (c.method === 'POST') return { body: { pr_id: PR, runs: [{ run_id: RUN, agent_id: AGENT }] } };
      if (c.path.endsWith('/runs')) return { body: [{ run_id: RUN, agent_id: AGENT, status: 'done' }] };
      return { body: [review({ findings: [] })] };
    });
    const r = await runAgentOnPr(deps, { pr_id: '3', repo: 'o/r', agent_id: AGENT });
    expect(r.isError).toBeFalsy();
    expect(calls.find((c) => c.method === 'POST')!.path).toBe(`/pulls/${PR}/review`);
  });
});

describe('get_findings — PR reference and all_runs', () => {
  const reviews = [
    review({ id: 'a1', run_id: 'run-a1', agent_id: AGENT, created_at: '2026-01-01T00:00:00Z' }),
    review({ id: 'a2', run_id: 'run-a2', agent_id: AGENT, created_at: '2026-01-03T00:00:00Z' }),
    review({ id: 'b1', run_id: 'run-b1', agent_id: AGENT2, created_at: '2026-01-02T00:00:00Z' }),
  ];
  const handler: Handler = (c) => {
    if (c.path.startsWith('/pulls?')) return { body: lookup([ref()], { repo_matches: ONE_REPO }) };
    if (c.path.endsWith('/reviews')) return { body: reviews };
    return { status: 404 };
  };
  const ids = (r: { structuredContent?: Record<string, unknown> }) =>
    (sc(r).reviews as { review_id: string }[]).map((x) => x.review_id);

  it('default: the latest review of each agent', async () => {
    const { deps } = makeDeps(handler);
    const r = await getFindings(deps, { pr_id: PR });
    expect(sc(r)).toMatchObject({ selection: 'latest_per_agent', truncated: false });
    expect(ids(r)).toEqual(['a2', 'b1']);
  });

  it('all_runs: every review of every run, newest first; all_runs false = default', async () => {
    const { deps } = makeDeps(handler);
    const all = await getFindings(deps, { pr_id: PR, all_runs: true });
    expect(sc(all).selection).toBe('all_runs');
    expect(ids(all)).toEqual(['a2', 'b1', 'a1']);
    expect(ids(await getFindings(deps, { pr_id: PR, all_runs: false }))).toEqual(['a2', 'b1']);
  });

  it('all_runs caps the list at 50 and sets truncated', async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      review({ id: `r${String(i).padStart(2, '0')}`, created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }),
    );
    const { deps } = makeDeps((c) => (c.path.endsWith('/reviews') ? { body: many } : { body: [] }));
    const r = await getFindings(deps, { pr_id: PR, all_runs: true });
    expect(ids(r)).toHaveLength(50);
    expect(sc(r).truncated).toBe(true);
    expect(textOf(r)).toContain('Only the newest 50 reviews are listed.');
  });

  it('"#3" + repo resolves before reading the reviews', async () => {
    const { deps, calls } = makeDeps(handler);
    const r = await getFindings(deps, { pr_id: '#3', repo: 'o/r' });
    expect(paths(calls)).toEqual(['GET /pulls?number=3&repo=o%2Fr', `GET /pulls/${PR}/reviews`]);
    expect(sc(r).pr_id).toBe(PR);
    expect(textOf(r)).toContain('Resolved PR #3 in o/r');
  });
});
