import { unzipSync, strFromU8 } from 'fflate';
import { CiResultArtifact, type RunTrace, type WorkflowRunArtifact, type WorkflowRunMeta } from '@devdigest/shared';
import { TimeoutError } from '../../platform/resilience.js';
import { MAX_ARTIFACT_BYTES, RESULT_ARTIFACT, RESULT_FILE, WORKFLOW_PATH } from './constants.js';

/**
 * Pure parts of the CI ingest (L07 B7, specs/export-to-ci.md §6.5, §7, G1;
 * AC-CI-41..47, 58, 87, 93). The artifact is untrusted: size-capped, only
 * `devdigest-result.json` is unzipped, then schema-validated. No LLM, no env.
 */

/** Why a run was not stored (reported in CiSyncResult.skipped). */
export type SkipReason =
  | 'foreign_repository'
  | 'foreign_workflow'
  | 'artifact_expired'
  | 'artifact_unavailable'
  | 'artifact_too_large'
  | 'artifact_missing_file'
  | 'invalid_artifact'
  | 'pr_mismatch'
  | 'workflow_not_published'
  | `no_artifact_${string}`;

/** AC-CI-43: a run must belong to the installation's repo and to the generated workflow file. */
export function foreignRun(run: WorkflowRunMeta, installationRepo: string): SkipReason | null {
  if (run.repository_full_name.toLowerCase() !== installationRepo.toLowerCase()) return 'foreign_repository';
  if (run.path !== WORKFLOW_PATH) return 'foreign_workflow';
  return null;
}

export type ArtifactChoice =
  | { kind: 'artifact'; artifact: WorkflowRunArtifact }
  | { kind: 'none' }
  | { kind: 'skip'; reason: SkipReason };

/** The run's `devdigest-result` artifact: expired or oversized → skip; absent → none. */
export function chooseArtifact(artifacts: readonly WorkflowRunArtifact[]): ArtifactChoice {
  const found = artifacts.find((a) => a.name === RESULT_ARTIFACT);
  if (!found) return { kind: 'none' };
  if (found.expired) return { kind: 'skip', reason: 'artifact_expired' };
  if (found.size_in_bytes > MAX_ARTIFACT_BYTES) return { kind: 'skip', reason: 'artifact_too_large' };
  return { kind: 'artifact', artifact: found };
}

/** G1: no artifact → store `failed` only for failure / timed_out; any other conclusion is skipped. */
export function withoutArtifact(conclusion: string | null): { store: true } | { store: false; reason: SkipReason } {
  if (conclusion === 'failure' || conclusion === 'timed_out') return { store: true };
  return { store: false, reason: `no_artifact_${conclusion ?? 'unknown'}` };
}

export type ParsedArtifact = { ok: true; artifact: CiResultArtifact } | { ok: false; reason: SkipReason };

/** Unzip only `devdigest-result.json` (≤ MAX_ARTIFACT_BYTES uncompressed) and validate it (AC-CI-41). */
export function parseArtifactZip(zip: Uint8Array): ParsedArtifact {
  let tooLarge = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        if (f.name !== RESULT_FILE) return false;
        if (f.originalSize > MAX_ARTIFACT_BYTES) {
          tooLarge = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, reason: 'invalid_artifact' };
  }
  if (tooLarge) return { ok: false, reason: 'artifact_too_large' };
  const bytes = files[RESULT_FILE];
  if (!bytes) return { ok: false, reason: 'artifact_missing_file' };
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) return { ok: false, reason: 'artifact_too_large' };
  try {
    const parsed = CiResultArtifact.safeParse(JSON.parse(strFromU8(bytes)));
    return parsed.success ? { ok: true, artifact: parsed.data } : { ok: false, reason: 'invalid_artifact' };
  } catch {
    return { ok: false, reason: 'invalid_artifact' };
  }
}

/** AC-CI-42: the PR number comes from the run; an artifact naming another PR is skipped. */
export function prNumberOf(run: WorkflowRunMeta, artifact: CiResultArtifact | null): number | null | SkipReason {
  const fromRun = run.pull_request_numbers[0] ?? null;
  if (artifact?.pr_number != null && fromRun != null && artifact.pr_number !== fromRun) return 'pr_mismatch';
  return fromRun;
}

/** `ci_runs.status` (CiRunStatus): no artifact → failed; else succeeded / no_findings. */
export function ciStatusOf(artifact: CiResultArtifact | null): 'succeeded' | 'no_findings' | 'failed' {
  if (!artifact) return 'failed';
  return artifact.findings_count > 0 ? 'succeeded' : 'no_findings';
}

export function runDurationMs(run: WorkflowRunMeta, artifact: CiResultArtifact | null): number | null {
  if (artifact?.duration_ms != null) return artifact.duration_ms;
  if (!run.run_started_at) return null;
  const ms = Date.parse(run.updated_at) - Date.parse(run.run_started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export interface CiTraceInput {
  agentName: string;
  repo: string;
  run: WorkflowRunMeta;
  prNumber: number | null;
  artifact: CiResultArtifact | null;
  durationMs: number | null;
}

/**
 * TA2: a valid RunTrace (existing readers keep working) + a `ci` object with
 * the §6.5 fields. Only values from the GitHub run object and the validated
 * artifact — never an env value or a token (AC-CI-47).
 */
export function buildCiTrace(input: CiTraceInput): RunTrace & { ci: Record<string, unknown> } {
  const a = input.artifact;
  return {
    config: {
      agent: input.agentName,
      version: a?.manifest_version != null ? String(a.manifest_version) : null,
      provider: 'openrouter',
      model: a?.model ?? 'unknown',
      pr: input.prNumber,
      source: 'ci',
    },
    stats: {
      duration_ms: input.durationMs ?? 0,
      tokens_in: 0,
      tokens_out: 0,
      findings: a?.findings_count ?? 0,
      grounding: 'ci',
      cost_usd: a ? a.cost_usd : null,
    },
    prompt_assembly: { system: '', user: '' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log: [],
    ci: {
      source: 'ci',
      manifest_version: a?.manifest_version ?? null,
      model: a?.model ?? null,
      dependencies: { runner_version: a?.version ?? null, skills: a?.skills ?? null },
      commit_sha: input.run.head_sha,
      repo: input.repo,
      github_repo_id: input.run.repository_id,
      pr_number: input.prNumber,
      github_run_id: input.run.id,
      github_run_url: input.run.html_url,
      conclusion: input.run.conclusion,
      cost_usd: a ? a.cost_usd : null,
      critical: a?.critical ?? null,
      warning: a?.warning ?? null,
      suggestion: a?.suggestion ?? null,
      gate_triggered: a?.gate_triggered ?? null,
      artifact: a !== null,
    },
  };
}

export type FailureKind = 'repo_access' | 'transient' | 'other';

/**
 * AC-CI-58, 87, 93: 401/403 → the repository is not accessible; network,
 * timeout, 429 and 5xx → transient; anything else (incl. a bare 404 from a
 * non-repository call) → other. A repository 404 is tagged by the caller.
 */
export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof RepoAccessError) return 'repo_access';
  if (err instanceof TimeoutError) return 'transient';
  const status = (err as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return 'repo_access';
  if (status === 429 || (typeof status === 'number' && status >= 500)) return 'transient';
  if (status === undefined) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNREFUSED') return 'transient';
  }
  return 'other';
}

/** The repository itself answered 404/401/403 (AC-CI-58). */
export class RepoAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RepoAccessError';
  }
}

/** A short, token-free description of a GitHub failure for CiSyncResult.errors. */
export function failureMessage(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status ? `GitHub HTTP ${status}: ${message}` : message;
}
