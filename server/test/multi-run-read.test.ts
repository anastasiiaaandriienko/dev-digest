import { describe, it, expect, vi, afterEach } from 'vitest';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockSecretsProvider } from '../src/adapters/mocks.js';
import type { Db } from '../src/db/client.js';
import type { FindingRow } from '../src/db/rows.js';
import { NotFoundError } from '../src/platform/errors.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { ReviewRow } from '../src/modules/reviews/repository/review.repo.js';
import { MultiRunRepository, type ChildRunRow } from '../src/modules/reviews/multi-run/repository.js';
import { MultiRunService } from '../src/modules/reviews/multi-run/service.js';
import { pullRow } from './helpers/run-cost-fixtures.js';

/**
 * L07 T4 — MultiRunService.read (AC-MAR-09..11, 55, 57). No DB: the
 * repositories are spied. DB-level filtering/ordering is covered by T12.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const T0 = new Date(Date.UTC(2026, 9, 23, 10));

function runRow(n: number, o: Partial<ChildRunRow['run']> = {}): ChildRunRow['run'] {
  return {
    id: `run-${n}`,
    workspaceId: 'ws',
    agentId: `agent-${n}`,
    prId: pullRow().id,
    ranAt: new Date(T0.getTime() + n),
    provider: 'openai',
    model: 'm',
    durationMs: 1000,
    tokensIn: 10,
    tokensOut: 5,
    status: 'done',
    error: null,
    source: 'local',
    findingsCount: 0,
    grounding: '1/1 passed',
    score: 80,
    blockers: 0,
    multiAgentRunId: 'multi-1',
    ...o,
  } as ChildRunRow['run'];
}

function findingRow(id: string, reviewId: string, o: Partial<FindingRow> = {}): FindingRow {
  return {
    id,
    reviewId,
    severity: 'WARNING',
    category: 'bug',
    title: `title ${id}`,
    file: 'a.ts',
    startLine: 10,
    endLine: 12,
    rationale: 'why',
    suggestion: 'fix',
    confidence: 0.8,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...o,
  } as FindingRow;
}

function setup(o: { pull?: boolean; parent?: boolean; children?: ChildRunRow[]; reviews?: ReviewRow[]; findings?: FindingRow[] } = {}) {
  const container = new Container(config(), {} as Db, { secrets: new MockSecretsProvider({}) });
  const getPull = vi
    .spyOn(ReviewRepository.prototype, 'getPull')
    .mockResolvedValue(o.pull === false ? undefined : pullRow({ number: 482 }));
  const latest = vi
    .spyOn(MultiRunRepository.prototype, 'latestForPull')
    .mockResolvedValue(o.parent === false ? undefined : { id: 'multi-1', workspaceId: 'ws', prId: pullRow().id, ranAt: T0 });
  const childrenOf = vi.spyOn(MultiRunRepository.prototype, 'childrenOf').mockResolvedValue(o.children ?? []);
  const reviewsForRuns = vi
    .spyOn(MultiRunRepository.prototype, 'reviewsForRuns')
    .mockResolvedValue({ reviews: o.reviews ?? [], findings: o.findings ?? [] });
  const evalIds = vi
    .spyOn(MultiRunRepository.prototype, 'evalCaseIdsForFindings')
    .mockResolvedValue(new Map([['f-1', 'case-9']]));
  // Any write during a read is a bug (requirement: reads never change findings or run statuses).
  const writes = [
    vi.spyOn(MultiRunRepository.prototype, 'createMultiRun'),
    vi.spyOn(ReviewRepository.prototype, 'createAgentRun'),
    vi.spyOn(ReviewRepository.prototype, 'recordRunFailed'),
    vi.spyOn(ReviewRepository.prototype, 'setFindingAccepted'),
    vi.spyOn(ReviewRepository.prototype, 'setFindingDismissed'),
    vi.spyOn(ReviewRepository.prototype, 'deleteAgentRun'),
  ];
  return { service: new MultiRunService(container), getPull, latest, childrenOf, reviewsForRuns, evalIds, writes };
}

describe('MultiRunService.read (L07 T4)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('AC-11: a PR outside the workspace → 404 and no multi-run lookup', async () => {
    const s = setup({ pull: false });
    await expect(s.service.read('ws', pullRow().id)).rejects.toBeInstanceOf(NotFoundError);
    expect(s.latest).not.toHaveBeenCalled();
  });

  it('AC-10: no multi-run for the PR → { multi_run: null }', async () => {
    const s = setup({ parent: false });
    await expect(s.service.read('ws', pullRow().id)).resolves.toEqual({ multi_run: null });
    expect(s.childrenOf).not.toHaveBeenCalled();
  });

  it('AC-09: assembles columns from linked children, their reviews and findings (with detail fields)', async () => {
    const s = setup({
      children: [
        { run: runRow(1), agentName: 'Security', costUsd: 0.02 },
        { run: runRow(2), agentName: 'Performance', costUsd: null },
      ],
      reviews: [
        { id: 'rev-1', runId: 'run-1', verdict: 'request_changes', summary: 'two issues', score: 40 } as ReviewRow,
        { id: 'rev-2', runId: 'run-2', verdict: 'approve', summary: 'fine', score: 95 } as ReviewRow,
      ],
      findings: [findingRow('f-1', 'rev-1', { severity: 'CRITICAL', acceptedAt: new Date(T0) })],
    });
    const { multi_run } = await s.service.read('ws', pullRow().id);

    expect(s.getPull).toHaveBeenCalledWith('ws', pullRow().id);
    expect(s.latest).toHaveBeenCalledWith('ws', pullRow().id);
    expect(s.childrenOf).toHaveBeenCalledWith('ws', 'multi-1');
    expect(s.reviewsForRuns).toHaveBeenCalledWith('ws', ['run-1', 'run-2']);
    expect(multi_run).toMatchObject({ id: 'multi-1', pr_number: 482, agent_count: 2, total_cost_usd: 0.02, cost_partial: true });
    expect(multi_run!.columns.map((c) => [c.agent_name, c.verdict, c.summary, c.score])).toEqual([
      ['Security', 'request_changes', 'two issues', 80],
      ['Performance', 'approve', 'fine', 80],
    ]);
    expect(multi_run!.columns[0]!.findings).toEqual([
      {
        id: 'f-1',
        severity: 'CRITICAL',
        category: 'bug',
        title: 'title f-1',
        file: 'a.ts',
        start_line: 10,
        end_line: 12,
        kind: 'finding',
        rationale: 'why',
        suggestion: 'fix',
        confidence: 0.8,
        review_id: 'rev-1',
        accepted_at: T0.toISOString(),
        dismissed_at: null,
        eval_case_id: 'case-9',
      },
    ]);
    expect(multi_run!.conflicts.map((c) => c.takes.map((t) => t.verdict))).toEqual([['CRITICAL', 'ignored']]);
  });

  it('a run without a review (failed/running) gets an empty column, not an error', async () => {
    const s = setup({
      children: [
        { run: runRow(1, { status: 'failed', error: 'boom', score: null }), agentName: 'A', costUsd: null },
        { run: runRow(2, { status: 'running', durationMs: null, score: null }), agentName: 'B', costUsd: null },
      ],
    });
    const { multi_run } = await s.service.read('ws', pullRow().id);
    expect(multi_run!.columns.map((c) => [c.status, c.error, c.verdict, c.findings.length])).toEqual([
      ['failed', 'boom', null, 0],
      ['running', null, null, 0],
    ]);
  });

  it('AC-57: a deleted child simply drops out (only the rows the repository returns are columns)', async () => {
    const s = setup({ children: [{ run: runRow(2), agentName: 'B', costUsd: 0.01 }] });
    const { multi_run } = await s.service.read('ws', pullRow().id);
    expect(multi_run!.columns.map((c) => c.run_id)).toEqual(['run-2']);
    expect(multi_run!.agent_count).toBe(1);
  });

  it('reads never write: no create/update/delete is called', async () => {
    const s = setup({
      children: [{ run: runRow(1), agentName: 'A', costUsd: 0.01 }],
      reviews: [{ id: 'rev-1', runId: 'run-1', verdict: 'comment', summary: 's', score: 50 } as ReviewRow],
      findings: [findingRow('f-1', 'rev-1')],
    });
    await s.service.read('ws', pullRow().id);
    for (const w of s.writes) expect(w).not.toHaveBeenCalled();
  });
});
