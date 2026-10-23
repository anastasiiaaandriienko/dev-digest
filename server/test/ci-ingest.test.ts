import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { RunTrace, type CiResultArtifact, type WorkflowRunMeta } from '@devdigest/shared';
import { MockGitHubClient, type MockGitHubOptions } from '../src/adapters/mocks.js';
import { TimeoutError } from '../src/platform/resilience.js';
import {
  buildCiTrace,
  chooseArtifact,
  ciStatusOf,
  classifyFailure,
  foreignRun,
  parseArtifactZip,
  prNumberOf,
  RepoAccessError,
  runDurationMs,
  withoutArtifact,
} from '../src/modules/ci/ingest-helpers.js';
import { CiSyncService, ManualSyncThrottle, type CiSyncDeps } from '../src/modules/ci/sync.js';
import type { CiInstallationListRow, CiInstallationRow, CiRunInsert, CiSyncClaim } from '../src/modules/ci/repository.js';
import { MAX_ARTIFACT_BYTES, WORKFLOW_PATH } from '../src/modules/ci/constants.js';

/**
 * L07 B7 — CI ingest & sync (specs/export-to-ci.md §6.5, §7, G1; AC-CI-40..49,
 * 55..58, 87, 88, 93): pure helpers, and CiSyncService against an in-memory
 * repository and MockGitHubClient. No DB, no network, no LLM.
 */

const WS = 'ws-1';
const REPO = 'acme/widgets';
const SECRET = 'sk-or-test-SECRET';

function run(id: number, over: Partial<WorkflowRunMeta> = {}): WorkflowRunMeta {
  return {
    id,
    head_sha: `sha${id}`,
    repository_id: 42,
    repository_full_name: REPO,
    head_repository_full_name: REPO,
    path: WORKFLOW_PATH,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
    pull_request_numbers: [7],
    run_started_at: '2026-10-23T10:00:00Z',
    updated_at: '2026-10-23T10:01:00Z',
    ...over,
  };
}

const ARTIFACT: CiResultArtifact = {
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.01,
  duration_ms: 4200,
  agent: 'Security Reviewer',
  version: '1',
  pr_number: 7,
  model: 'openai/gpt-4.1',
  manifest_version: 3,
  gate_triggered: true,
  blockers: 1,
  skills: ['owasp'],
};
const zipOf = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const resultZip = (a: unknown = ARTIFACT) => zipOf({ 'devdigest-result.json': JSON.stringify(a) });

// ---- pure helpers -------------------------------------------------------------

describe('ingest helpers', () => {
  it('foreignRun: other repository (case-insensitive match allowed) or other workflow path (AC-CI-43)', () => {
    expect(foreignRun(run(1), 'ACME/Widgets')).toBeNull();
    expect(foreignRun(run(1, { repository_full_name: 'evil/widgets' }), REPO)).toBe('foreign_repository');
    expect(foreignRun(run(1, { path: '.github/workflows/other.yml' }), REPO)).toBe('foreign_workflow');
  });

  it('chooseArtifact: devdigest-result only; expired or oversized is skipped; absent → none', () => {
    const a = (over = {}) => ({ id: 5, name: 'devdigest-result', size_in_bytes: 100, expired: false, ...over });
    expect(chooseArtifact([a()])).toEqual({ kind: 'artifact', artifact: a() });
    expect(chooseArtifact([a({ name: 'other' })])).toEqual({ kind: 'none' });
    expect(chooseArtifact([a({ expired: true })])).toEqual({ kind: 'skip', reason: 'artifact_expired' });
    expect(chooseArtifact([a({ size_in_bytes: MAX_ARTIFACT_BYTES + 1 })])).toEqual({ kind: 'skip', reason: 'artifact_too_large' });
  });

  it('withoutArtifact (G1): only failure / timed_out are stored as failed', () => {
    expect(withoutArtifact('failure')).toEqual({ store: true });
    expect(withoutArtifact('timed_out')).toEqual({ store: true });
    for (const c of ['success', 'skipped', 'cancelled', 'neutral', 'stale', 'action_required', null]) {
      expect(withoutArtifact(c)).toEqual({ store: false, reason: `no_artifact_${c ?? 'unknown'}` });
    }
  });

  it('parseArtifactZip: validates the result; invalid, missing, oversized or corrupt → skip reasons (AC-CI-41)', () => {
    expect(parseArtifactZip(resultZip())).toEqual({ ok: true, artifact: ARTIFACT });
    expect(parseArtifactZip(resultZip({ ...ARTIFACT, findings_count: -1 }))).toEqual({ ok: false, reason: 'invalid_artifact' });
    expect(parseArtifactZip(zipOf({ 'devdigest-result.json': '{not json' }))).toEqual({ ok: false, reason: 'invalid_artifact' });
    expect(parseArtifactZip(zipOf({ 'other.json': '{}' }))).toEqual({ ok: false, reason: 'artifact_missing_file' });
    expect(parseArtifactZip(zipOf({ 'devdigest-result.json': 'x'.repeat(MAX_ARTIFACT_BYTES + 1) }))).toEqual({ ok: false, reason: 'artifact_too_large' });
    expect(parseArtifactZip(new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, reason: 'invalid_artifact' });
  });

  it('prNumberOf: from the run; an artifact naming another PR is skipped (AC-CI-42)', () => {
    expect(prNumberOf(run(1), ARTIFACT)).toBe(7);
    expect(prNumberOf(run(1), { ...ARTIFACT, pr_number: 8 })).toBe('pr_mismatch');
    expect(prNumberOf(run(1, { pull_request_numbers: [] }), ARTIFACT)).toBeNull();
    expect(prNumberOf(run(1), null)).toBe(7);
  });

  it('status and duration', () => {
    expect(ciStatusOf(ARTIFACT)).toBe('succeeded');
    expect(ciStatusOf({ ...ARTIFACT, findings_count: 0 })).toBe('no_findings');
    expect(ciStatusOf(null)).toBe('failed');
    expect(runDurationMs(run(1), ARTIFACT)).toBe(4200);
    expect(runDurationMs(run(1), null)).toBe(60_000);
    expect(runDurationMs(run(1, { run_started_at: null }), null)).toBeNull();
  });

  it('buildCiTrace: a valid RunTrace with the §6.5 ci fields and no env value (TA2, AC-CI-47)', () => {
    process.env.OPENROUTER_API_KEY = SECRET;
    try {
      const tr = buildCiTrace({ agentName: 'Sec', repo: REPO, run: run(9), prNumber: 7, artifact: ARTIFACT, durationMs: 4200 });
      expect(RunTrace.safeParse(tr).success).toBe(true);
      expect(tr.config).toMatchObject({ source: 'ci', model: 'openai/gpt-4.1', version: '3', pr: 7 });
      expect(tr.stats.cost_usd).toBe(0.01);
      expect(tr.ci).toMatchObject({
        manifest_version: 3,
        dependencies: { runner_version: '1', skills: ['owasp'] },
        commit_sha: 'sha9',
        github_repo_id: 42,
        github_run_id: 9,
        gate_triggered: true,
      });
      const failed = buildCiTrace({ agentName: 'Sec', repo: REPO, run: run(9, { conclusion: 'failure' }), prNumber: 7, artifact: null, durationMs: null });
      expect(RunTrace.safeParse(failed).success).toBe(true);
      expect(failed.stats.cost_usd).toBeNull();
      expect(JSON.stringify([tr, failed])).not.toContain(SECRET);
    } finally {
      delete process.env.OPENROUTER_API_KEY;
    }
  });

  it('classifyFailure: 401/403 repo access; 429/5xx/timeout/network transient; other incl. bare 404 → other', () => {
    const e = (status?: number) => Object.assign(new Error('x'), status ? { status } : {});
    expect(classifyFailure(e(401))).toBe('repo_access');
    expect(classifyFailure(e(403))).toBe('repo_access');
    expect(classifyFailure(new RepoAccessError('gone', 404))).toBe('repo_access');
    for (const s of [429, 500, 502, 503]) expect(classifyFailure(e(s))).toBe('transient');
    expect(classifyFailure(new TimeoutError(10))).toBe('transient');
    expect(classifyFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe('transient');
    expect(classifyFailure(e(404))).toBe('other');
    expect(classifyFailure(e(422))).toBe('other');
  });
});

// ---- CiSyncService with an in-memory repository -------------------------------------

class FakeRepo {
  rows: CiInstallationListRow[] = [];
  inserted: CiRunInsert[] = [];
  statuses: { id: string; status: string }[] = [];
  released: CiSyncClaim[] = [];
  manual: string[] = [];
  claimable = new Set<string>();
  stored = new Set<string>(); // `${installationId}:${githubRunId}`
  pulls = new Map<string, string>(); // `${repo}#${n}` → pr id

  add(id: string, status: CiInstallationRow['status'] = 'pending') {
    const installation: CiInstallationRow = {
      id,
      agentId: 'agent-1',
      repo: REPO,
      targetType: 'gha',
      installedAt: new Date(),
      status,
      agentVersion: 3,
      prUrl: null,
      updatedAt: new Date(),
      lastSyncedAt: null,
    };
    this.rows.push({ installation, agentName: 'Security Reviewer', lastRunStatus: null, lastRunAt: null });
    this.claimable.add(id);
    return installation;
  }
  async listForWorkspace(ws: string, id?: string) {
    return ws === WS ? this.rows.filter((r) => !id || r.installation.id === id) : [];
  }
  async claimForAutoSync(_ws: string, opts: { installationId?: string } = {}) {
    const claims: CiSyncClaim[] = [];
    for (const r of this.rows) {
      if (opts.installationId && r.installation.id !== opts.installationId) continue;
      if (!this.claimable.delete(r.installation.id)) continue;
      claims.push({ installationId: r.installation.id, claimedAt: 'now', previous: null });
    }
    return claims;
  }
  async releaseAutoSyncClaim(claim: CiSyncClaim) {
    this.released.push(claim);
    this.claimable.add(claim.installationId);
    return true;
  }
  async markManualSynced(id: string) {
    this.manual.push(id);
  }
  async setStatus(id: string, status: CiInstallationRow['status']) {
    this.statuses.push({ id, status });
  }
  async existingGithubRunIds(id: string, ids: readonly number[]) {
    return new Set(ids.filter((g) => this.stored.has(`${id}:${g}`)));
  }
  async insertCiRun(input: CiRunInsert) {
    const key = `${input.installationId}:${input.githubRunId}`;
    if (this.stored.has(key)) return { inserted: false as const, reason: 'duplicate' as const };
    this.stored.add(key);
    this.inserted.push(input);
    return { inserted: true as const, agentRunId: `ar-${this.inserted.length}`, ciRunId: `cr-${this.inserted.length}` };
  }
  async findPullId(_ws: string, repo: string, n: number) {
    return this.pulls.get(`${repo}#${n}`) ?? null;
  }
  async listRuns() {
    return [];
  }
}

function setup(gh: MockGitHubOptions = {}, opts: { now?: () => number } = {}) {
  const repo = new FakeRepo();
  const github = new MockGitHubClient(gh);
  const deps: CiSyncDeps = {
    repo,
    github: async () => github,
    now: opts.now ?? (() => 1_000_000),
    manualThrottle: new ManualSyncThrottle(),
    autoSyncIntervalMs: 600_000,
  };
  return { repo, github, service: new CiSyncService({} as never, deps), deps };
}

describe('sync: ingest (AC-CI-40..47)', () => {
  it('stores a valid run with the run object’s SHA / repo id / PR / URL and the artifact counts', async () => {
    const { repo, service } = setup({
      workflowRuns: [run(101)],
      runArtifacts: { 101: [{ id: 5, name: 'devdigest-result', size_in_bytes: 300, expired: false }] },
      artifactZips: { 5: resultZip() },
    });
    const inst = repo.add('i1');
    repo.pulls.set(`${REPO}#7`, 'pr-uuid');
    const res = await service.sync(WS, { mode: 'manual' });
    expect(res).toEqual({ ingested: 1, throttled: 0, skipped: [], errors: [] });
    expect(repo.inserted[0]).toMatchObject({
      installationId: inst.id,
      githubRunId: 101,
      githubRepoId: 42,
      commitSha: 'sha101',
      prNumber: 7,
      githubUrl: `https://github.com/${REPO}/actions/runs/101`,
      runStatus: 'done',
      ciStatus: 'succeeded',
      model: 'openai/gpt-4.1',
      findingsCount: 2,
      blockers: 1,
      durationMs: 4200,
      costUsd: 0.01,
      prId: 'pr-uuid',
    });
    expect(repo.manual).toEqual(['i1']);
  });

  it('G1: failure/timed_out without artifact stored as failed; success/cancelled/skipped without artifact skipped', async () => {
    const { repo, service } = setup({
      workflowRuns: [
        run(1, { conclusion: 'failure' }),
        run(2, { conclusion: 'timed_out' }),
        run(3, { conclusion: 'success' }),
        run(4, { conclusion: 'cancelled' }),
        run(5, { conclusion: 'skipped' }),
      ],
    });
    repo.add('i1');
    const res = await service.sync(WS, { mode: 'manual' });
    expect(res.ingested).toBe(2);
    expect(repo.inserted.map((r) => [r.githubRunId, r.runStatus, r.ciStatus, r.findingsCount])).toEqual([
      [1, 'failed', 'failed', null],
      [2, 'failed', 'failed', null],
    ]);
    expect(res.skipped.map((s) => [s.github_run_id, s.reason])).toEqual([
      [3, 'no_artifact_success'],
      [4, 'no_artifact_cancelled'],
      [5, 'no_artifact_skipped'],
    ]);
  });

  it('skips foreign, invalid, mismatched, expired and unavailable artifacts with reasons; already stored runs silently', async () => {
    const art = (id: number, over = {}) => [{ id, name: 'devdigest-result', size_in_bytes: 300, expired: false, ...over }];
    const { repo, service } = setup({
      workflowRuns: [
        run(1, { repository_full_name: 'evil/x' }),
        run(2, { path: '.github/workflows/x.yml' }),
        run(3),
        run(4),
        run(5),
        run(6),
        run(7),
      ],
      runArtifacts: { 3: art(30), 4: art(40), 5: art(50, { expired: true }), 6: art(60), 7: art(70) },
      artifactZips: { 30: resultZip({ nope: 1 }), 40: resultZip({ ...ARTIFACT, pr_number: 99 }), 70: resultZip() },
      // 60 has no zip → the mock answers 404
    });
    repo.add('i1');
    repo.stored.add('i1:7');
    const res = await service.sync(WS, { mode: 'manual' });
    expect(res.ingested).toBe(0);
    expect(res.errors).toEqual([]);
    expect(res.skipped.map((s) => [s.github_run_id, s.reason])).toEqual([
      [1, 'foreign_repository'],
      [2, 'foreign_workflow'],
      [3, 'invalid_artifact'],
      [4, 'pr_mismatch'],
      [5, 'artifact_expired'],
      [6, 'artifact_unavailable'],
    ]);
  });

  it('a concurrent sync storing the run first (duplicate) is not counted twice', async () => {
    const { repo, service } = setup({ workflowRuns: [run(1, { conclusion: 'failure' })] });
    repo.add('i1');
    repo.existingGithubRunIds = async () => new Set(); // the other sync wins between check and insert
    repo.stored.add('i1:1');
    expect(await service.sync(WS, { mode: 'manual' })).toMatchObject({ ingested: 0, errors: [] });
    expect(repo.inserted).toEqual([]);
  });
});

describe('sync: workflow 404 vs repository 404 (AC-CI-58, 93)', () => {
  it('runs 404 + readable repository → workflow_not_published; pending stays, no error, claim kept', async () => {
    const { repo, service } = setup({ failWith: { listWorkflowRuns: 404 } });
    repo.add('i1', 'pending');
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res).toEqual({ ingested: 0, throttled: 0, skipped: [{ installation_id: 'i1', github_run_id: null, reason: 'workflow_not_published' }], errors: [] });
    expect(repo.statuses).toEqual([]);
    expect(repo.released).toEqual([]);
  });

  it('a manual sync of a not-yet-published workflow also counts as done (last_synced_at set)', async () => {
    const { repo, service } = setup({ failWith: { listWorkflowRuns: 404 } });
    repo.add('i1', 'pending');
    await service.sync(WS, { mode: 'manual' });
    expect(repo.manual).toEqual(['i1']);
  });

  it.each([404, 401, 403])('runs 404 + repository %s → error status, listed in errors, claim kept', async (status) => {
    const { repo, service } = setup({ failWith: { listWorkflowRuns: 404, getDefaultBranch: status } });
    repo.add('i1', 'pending');
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res.skipped).toEqual([]);
    expect(res.errors).toEqual([expect.objectContaining({ installation_id: 'i1', repo: REPO })]);
    expect(res.errors[0]!.message).toContain(`HTTP ${status}`);
    expect(repo.statuses).toEqual([{ id: 'i1', status: 'error' }]);
    expect(repo.released).toEqual([]);
  });

  it.each([401, 403])('runs %s directly → error status', async (status) => {
    const { repo, service } = setup({ failWith: { listWorkflowRuns: status } });
    repo.add('i1', 'active');
    await service.sync(WS, { mode: 'auto' });
    expect(repo.statuses).toEqual([{ id: 'i1', status: 'error' }]);
  });

  it.each([
    ['repository read', { listWorkflowRuns: 404, getDefaultBranch: 503 }],
    ['runs', { listWorkflowRuns: 502 }],
    ['rate limit', { listWorkflowRuns: 429 }],
    ['artifact list', { listRunArtifacts: 500 }],
  ] as const)('transient failure (%s) → claim released, status unchanged (AC-CI-87)', async (_name, failWith) => {
    const { repo, service } = setup({ failWith, workflowRuns: [run(1)] });
    repo.add('i1', 'pending');
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res.errors).toHaveLength(1);
    expect(repo.statuses).toEqual([]);
    expect(repo.released.map((c) => c.installationId)).toEqual(['i1']);
  });

  it('any other GitHub error is an error, never an empty run list (status unchanged, claim kept)', async () => {
    const { repo, service } = setup({ failWith: { listWorkflowRuns: 422 } });
    repo.add('i1', 'active');
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res.skipped).toEqual([]);
    expect(res.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('HTTP 422') })]);
    expect(repo.statuses).toEqual([]);
    expect(repo.released).toEqual([]);
  });

  it('one failing installation does not stop the others (AC-CI-48)', async () => {
    const { repo, service, github } = setup({ workflowRuns: [run(1, { conclusion: 'failure' })] });
    repo.add('i1');
    repo.rows.push({ ...repo.rows[0]!, installation: { ...repo.rows[0]!.installation, id: 'i2', repo: 'acme/gone' } });
    repo.claimable.add('i2');
    const original = github.listWorkflowRuns.bind(github);
    github.listWorkflowRuns = async (ref, file, o) => {
      if (ref.name === 'gone') throw Object.assign(new Error('Bad credentials'), { status: 401 });
      return original(ref, file, o);
    };
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res.ingested).toBe(1);
    expect(res.errors.map((e) => e.installation_id)).toEqual(['i2']);
    expect(repo.statuses).toEqual([{ id: 'i2', status: 'error' }]);
  });
});

describe('sync: throttles (AC-CI-49, 55, 56, 88)', () => {
  it('auto: only claimed installations are synced; the rest count as throttled with zero GitHub calls', async () => {
    const { repo, service, github } = setup();
    repo.add('i1');
    repo.claimable.delete('i1'); // synced less than 10 minutes ago
    expect(await service.sync(WS, { mode: 'auto' })).toEqual({ ingested: 0, throttled: 1, skipped: [], errors: [] });
    expect(github.calls).toEqual([]);
  });

  it('manual: at most once per installation per 60 s, independent of the auto claim', async () => {
    let now = 1_000_000;
    const { repo, service, github } = setup({}, { now: () => now });
    repo.add('i1');
    repo.claimable.delete('i1');
    expect((await service.sync(WS, { mode: 'manual' })).throttled).toBe(0);
    const calls = github.calls.length;
    expect((await service.sync(WS, { mode: 'manual' })).throttled).toBe(1);
    expect(github.calls.length).toBe(calls); // no GitHub call when throttled
    now += 60_000;
    expect((await service.sync(WS, { mode: 'manual' })).throttled).toBe(0);
  });

  it('an unknown installation id → 404; another workspace sees nothing', async () => {
    const { repo, service } = setup();
    repo.add('i1');
    await expect(service.sync(WS, { mode: 'manual', installation_id: 'nope' })).rejects.toMatchObject({ statusCode: 404 });
    expect(await service.sync('other-ws', { mode: 'manual' })).toEqual({ ingested: 0, throttled: 0, skipped: [], errors: [] });
  });

  it('no GitHub token: every due installation is reported and its claim released', async () => {
    const { repo, deps } = setup();
    repo.add('i1');
    const service = new CiSyncService({} as never, { ...deps, github: async () => Promise.reject(new Error('GITHUB_TOKEN is not configured')) });
    const res = await service.sync(WS, { mode: 'auto' });
    expect(res.errors).toEqual([{ installation_id: 'i1', repo: REPO, message: 'GITHUB_TOKEN is not configured' }]);
    expect(repo.released).toHaveLength(1);
    expect(repo.statuses).toEqual([]);
  });

  it('ManualSyncThrottle keeps per-installation windows', () => {
    const t = new ManualSyncThrottle(60_000);
    expect(t.tryAcquire('a', 0)).toBe(true);
    expect(t.tryAcquire('a', 59_999)).toBe(false);
    expect(t.tryAcquire('b', 1)).toBe(true);
    expect(t.tryAcquire('a', 60_000)).toBe(true);
  });
});
