import type { CiRun, CiSyncInput, CiSyncResult, GitHubClient, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { CI_RUNS_LIST_LIMIT, MANUAL_SYNC_INTERVAL_MS, MAX_ARTIFACT_BYTES, SYNC_RUNS_PER_INSTALLATION, WORKFLOW_FILE } from './constants.js';
import {
  buildCiTrace,
  chooseArtifact,
  ciStatusOf,
  classifyFailure,
  failureMessage,
  foreignRun,
  parseArtifactZip,
  prNumberOf,
  RepoAccessError,
  runDurationMs,
  withoutArtifact,
  type SkipReason,
} from './ingest-helpers.js';
import { AUTO_SYNC_INTERVAL_MS, CiRepository, type CiInstallationListRow, type CiRunListRow, type CiSyncClaim } from './repository.js';
import type { CiResultArtifact, WorkflowRunMeta } from '@devdigest/shared';

/**
 * CI ingest & sync (L07 B7, specs/export-to-ci.md §7; AC-CI-40..49, 55..58,
 * 87, 88, 93). The studio pulls finished `devdigest-review.yml` runs and their
 * `devdigest-result` artifacts over its own GitHub token; nothing is pushed to
 * it and there is no background loop. Sync is triggered manually (≤ 1 per
 * installation per 60 s, in-process, TA3) or automatically on page open (an
 * atomic `last_synced_at` claim, 10 min, TA4). No LLM call, no env value read.
 */

/** TA3: manual syncs per installation, in this API process. */
export class ManualSyncThrottle {
  private readonly last = new Map<string, number>();
  constructor(private readonly intervalMs = MANUAL_SYNC_INTERVAL_MS) {}

  /** Records the attempt and returns true when the installation may sync now. */
  tryAcquire(installationId: string, now: number): boolean {
    const previous = this.last.get(installationId);
    if (previous !== undefined && now - previous < this.intervalMs) return false;
    this.last.set(installationId, now);
    return true;
  }
}

const PROCESS_MANUAL_THROTTLE = new ManualSyncThrottle();

export interface CiSyncDeps {
  repo: Pick<
    CiRepository,
    | 'listForWorkspace'
    | 'claimForAutoSync'
    | 'releaseAutoSyncClaim'
    | 'markManualSynced'
    | 'setStatus'
    | 'existingGithubRunIds'
    | 'insertCiRun'
    | 'findPullId'
    | 'listRuns'
  >;
  github: () => Promise<GitHubClient>;
  now: () => number;
  manualThrottle: ManualSyncThrottle;
  autoSyncIntervalMs: number;
}

interface InstallationOutcome {
  ingested: number;
  skipped: CiSyncResult['skipped'];
}

export class CiSyncService {
  private readonly deps: CiSyncDeps;

  constructor(container: Container, deps: Partial<CiSyncDeps> = {}) {
    this.deps = {
      repo: deps.repo ?? new CiRepository(container.db),
      github: deps.github ?? (() => container.github()),
      now: deps.now ?? Date.now,
      manualThrottle: deps.manualThrottle ?? PROCESS_MANUAL_THROTTLE,
      autoSyncIntervalMs: deps.autoSyncIntervalMs ?? AUTO_SYNC_INTERVAL_MS,
    };
  }

  /** POST /ci/runs/sync (AC-CI-40, 48, 49, 55..58, 87, 88, 93). */
  async sync(workspaceId: string, input: CiSyncInput): Promise<CiSyncResult> {
    const all = await this.deps.repo.listForWorkspace(workspaceId, input.installation_id);
    if (input.installation_id && all.length === 0) throw new NotFoundError('CI installation not found');
    const result: CiSyncResult = { ingested: 0, throttled: 0, skipped: [], errors: [] };

    // Who is due: an automatic sync claims atomically; a manual one is throttled in-process.
    const due: { row: CiInstallationListRow; claim: CiSyncClaim | null }[] = [];
    if (input.mode === 'auto') {
      const claims = await this.deps.repo.claimForAutoSync(workspaceId, {
        installationId: input.installation_id,
        intervalMs: this.deps.autoSyncIntervalMs,
      });
      const byId = new Map(claims.map((c) => [c.installationId, c]));
      for (const row of all) {
        const claim = byId.get(row.installation.id);
        if (claim) due.push({ row, claim });
        else result.throttled++;
      }
    } else {
      const now = this.deps.now();
      for (const row of all) {
        if (this.deps.manualThrottle.tryAcquire(row.installation.id, now)) due.push({ row, claim: null });
        else result.throttled++;
      }
    }
    if (due.length === 0) return result;

    let gh: GitHubClient;
    try {
      gh = await this.deps.github();
    } catch (err) {
      // e.g. no GitHub token configured: report, and let the next sync try again.
      for (const { row, claim } of due) {
        result.errors.push({ installation_id: row.installation.id, repo: row.installation.repo, message: failureMessage(err) });
        if (claim) await this.deps.repo.releaseAutoSyncClaim(claim);
      }
      return result;
    }

    // One installation at a time: bounded GitHub load, partial failures stay local (AC-CI-48).
    for (const { row, claim } of due) {
      try {
        const outcome = await this.syncInstallation(gh, workspaceId, row);
        result.ingested += outcome.ingested;
        result.skipped.push(...outcome.skipped);
        if (!claim) await this.deps.repo.markManualSynced(row.installation.id);
      } catch (err) {
        result.errors.push({ installation_id: row.installation.id, repo: row.installation.repo, message: failureMessage(err) });
        const kind = classifyFailure(err);
        if (kind === 'repo_access') {
          // AC-CI-58: the claim is kept (10-minute back-off), the installation shows `error`.
          await this.deps.repo.setStatus(row.installation.id, 'error');
        } else if (kind === 'transient' && claim) {
          // AC-CI-87: put the previous last_synced_at back so the next page open retries.
          await this.deps.repo.releaseAutoSyncClaim(claim);
        }
      }
    }
    return result;
  }

  /** GET /ci/runs (AC-CI-51, 82): newest first, ≤ 50, optional agent / repo filters. */
  async listRuns(workspaceId: string, filters: { agentId?: string; repo?: string }): Promise<CiRun[]> {
    const rows = await this.deps.repo.listRuns(workspaceId, { ...filters, limit: CI_RUNS_LIST_LIMIT });
    return rows.map(toCiRun);
  }

  private async syncInstallation(gh: GitHubClient, workspaceId: string, row: CiInstallationListRow): Promise<InstallationOutcome> {
    const inst = row.installation;
    const ref = toRepoRef(inst.repo);
    const outcome: InstallationOutcome = { ingested: 0, skipped: [] };
    const skip = (githubRunId: number | null, reason: SkipReason) =>
      outcome.skipped.push({ installation_id: inst.id, github_run_id: githubRunId, reason });

    let runs: WorkflowRunMeta[];
    try {
      runs = await gh.listWorkflowRuns(ref, WORKFLOW_FILE, { perPage: SYNC_RUNS_PER_INSTALLATION });
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
      // AC-CI-93: is it the workflow (not on the default branch yet) or the repository?
      await this.assertRepositoryReadable(gh, ref);
      skip(null, 'workflow_not_published');
      return outcome;
    }

    const candidates = runs.filter((run) => {
      const foreign = foreignRun(run, inst.repo);
      if (foreign) skip(run.id, foreign);
      return !foreign;
    });
    const stored = await this.deps.repo.existingGithubRunIds(inst.id, candidates.map((r) => r.id));

    for (const run of candidates) {
      if (stored.has(run.id)) continue;
      const artifact = await this.loadArtifact(gh, ref, run);
      if (artifact.kind === 'skip') {
        skip(run.id, artifact.reason);
        continue;
      }
      const data = artifact.kind === 'artifact' ? artifact.data : null;
      const pr = prNumberOf(run, data);
      if (typeof pr === 'string') {
        skip(run.id, pr);
        continue;
      }
      const durationMs = runDurationMs(run, data);
      const res = await this.deps.repo.insertCiRun({
        installationId: inst.id,
        githubRunId: run.id,
        githubRepoId: run.repository_id,
        commitSha: run.head_sha,
        prNumber: pr,
        githubUrl: run.html_url,
        ranAt: new Date(run.run_started_at ?? run.updated_at),
        runStatus: data ? 'done' : 'failed',
        ciStatus: ciStatusOf(data),
        model: data?.model ?? null,
        findingsCount: data ? data.findings_count : null,
        blockers: data?.blockers ?? null,
        durationMs,
        costUsd: data ? data.cost_usd : null,
        prId: pr === null ? null : await this.deps.repo.findPullId(workspaceId, inst.repo, pr),
        trace: buildCiTrace({ agentName: row.agentName, repo: inst.repo, run, prNumber: pr, artifact: data, durationMs }),
      });
      // `duplicate`: a concurrent sync stored it first — one row either way (AC-CI-44).
      if (res.inserted) outcome.ingested++;
    }
    return outcome;
  }

  /** After a workflow-runs 404: a readable repository means "not published yet"; else the repository is the problem. */
  private async assertRepositoryReadable(gh: GitHubClient, ref: RepoRef): Promise<void> {
    try {
      await gh.getDefaultBranch(ref);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 401 || status === 403) {
        throw new RepoAccessError(`Repository ${ref.owner}/${ref.name} is not accessible (GitHub HTTP ${status})`, status);
      }
      throw err; // transient or other: never turned into "no runs"
    }
  }

  private async loadArtifact(
    gh: GitHubClient,
    ref: RepoRef,
    run: WorkflowRunMeta,
  ): Promise<{ kind: 'artifact'; data: CiResultArtifact } | { kind: 'none' } | { kind: 'skip'; reason: SkipReason }> {
    const choice = chooseArtifact(await gh.listRunArtifacts(ref, run.id));
    if (choice.kind === 'skip') return choice;
    if (choice.kind === 'none') {
      const rule = withoutArtifact(run.conclusion);
      return rule.store ? { kind: 'none' } : { kind: 'skip', reason: rule.reason };
    }
    let zip: Uint8Array;
    try {
      zip = await gh.downloadArtifact(ref, choice.artifact.id, { maxBytes: MAX_ARTIFACT_BYTES });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 413) return { kind: 'skip', reason: 'artifact_too_large' };
      if (status === 404 || status === 410) return { kind: 'skip', reason: 'artifact_unavailable' };
      throw err;
    }
    const parsed = parseArtifactZip(zip);
    return parsed.ok ? { kind: 'artifact', data: parsed.artifact } : { kind: 'skip', reason: parsed.reason };
  }
}

function toRepoRef(fullName: string): RepoRef {
  const [owner, name] = fullName.split('/');
  return { owner: owner!, name: name! };
}

function toCiRun(r: CiRunListRow): CiRun {
  return {
    id: r.id,
    ci_installation_id: r.installationId,
    pr_number: r.prNumber,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
    status: r.status,
    findings_count: r.findingsCount,
    cost_usd: r.costUsd,
    github_url: r.githubUrl,
    source: r.source,
    agent: r.agentName,
    duration_s: r.durationMs != null ? r.durationMs / 1000 : null,
    repo: r.repo,
    commit_sha: r.commitSha,
    verdict: r.verdict,
    agent_run_id: r.agentRunId,
  };
}
