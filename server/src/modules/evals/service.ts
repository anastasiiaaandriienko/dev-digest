import type {
  AgentEvalCase,
  AgentEvalRun,
  AgentEvalRunDetail,
  CreateEvalCaseFromFinding,
  EvalConfigSnapshot,
  EvalRunComparison,
  LLMProvider,
  Provider,
  StartEvalRunInput,
  UnifiedDiff,
} from '@devdigest/shared';
import { EvalExpectation } from '@devdigest/shared';
import { createHash } from 'node:crypto';
import type { AgentRow, FindingRow, PullRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { ReviewRepository, type ReviewRow } from '../reviews/repository.js';
import {
  EVAL_EXCLUDED_INPUTS,
  EVAL_MAX_CASES,
  EVAL_MAX_DIFF_CHARS,
  EVAL_MAX_INPUT_GROUPS,
  EVAL_RUNS_DEFAULT_LIMIT,
  EVAL_RUNS_MAX_LIMIT,
  EVAL_STALE_RUN_MINUTES,
} from './constants.js';
import {
  clampLimit,
  computeInputHash,
  defaultCaseName,
  diffStats,
  evalError,
  findLocationConflict,
  isTooWide,
  labelFromDecision,
  locationInDiff,
  normalizePath,
  normalizeRange,
  toAgentEvalCase,
  toAgentEvalRun,
  uniqueCaseName,
} from './helpers.js';
import { compareRuns, parseRunConfig, toAgentEvalRunDetail, toCaseRunResults } from './history.js';
import { EvalRepository } from './repository.js';
import { EvalRunner, groupCases, type EvalRunJob } from './runner.js';

/** The slice of `EvalRepository` the service needs (a fake in unit tests). */
export type EvalStore = Pick<
  EvalRepository,
  | 'getAgent'
  | 'listAgentEvalCases'
  | 'listLastCaseResults'
  | 'listAgentEvalRuns'
  | 'createCaseLocked'
  | 'agentVersionOfRun'
  | 'insertAgentEvalRun'
  | 'getRunningAgentEvalRun'
  | 'finalizeAgentEvalRun'
  | 'failAgentEvalRun'
  | 'failRunningAgentEvalRuns'
  | 'getAgentEvalRun'
  | 'listEvalCaseResults'
  | 'isAgentEvalRunRunning'
>;

/**
 * Eval runs executing in THIS process (module-level: routes and the boot reaper build
 * separate EvalService instances). A run in this set is never treated as stale, however
 * long it takes — so a second start for its agent gets 409 instead of a parallel paid
 * run. Only a `running` row that no process here is executing (its process died) can be
 * failed as stale; after a restart the boot reaper fails every `running` row.
 */
const ACTIVE_EVAL_RUNS = new Set<string>();

/** The agent config + skills the runner snapshots (the agents repository by default). */
export interface EvalAgentSource {
  getById(workspaceId: string, agentId: string): Promise<AgentRow | undefined>;
  effectiveSkills(workspaceId: string, agentId: string): Promise<{ id: string; name: string; version: number; body: string }[]>;
}

/** Where a finding, its PR and the PR's diff come from (the reviews module by default). */
export interface EvalFindingSource {
  findingContext(findingId: string): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined>;
  /** The PR diff + `owner/name`, or null when it cannot be loaded. */
  loadPullDiff(workspaceId: string, pull: PullRow): Promise<{ diff: UnifiedDiff; repo: string } | null>;
}

export interface EvalServiceOptions {
  store?: EvalStore;
  source?: EvalFindingSource;
  agents?: EvalAgentSource;
  llm?: (provider: Provider) => Promise<LLMProvider>;
  /** Test seam: replaces the background runner. */
  runner?: { execute(job: EvalRunJob): Promise<unknown> };
  now?: () => number;
}

function reviewsSource(container: Container): EvalFindingSource {
  const reviews = new ReviewRepository(container.db);
  return {
    findingContext: (findingId) => reviews.findingContext(findingId),
    async loadPullDiff(workspaceId, pull) {
      const repoRow = await reviews.getRepo(pull.repoId);
      if (!repoRow) return null;
      try {
        // Same diff the review used: git diff base...head, else the stored pr_files patches.
        const diff = await loadDiff(container, reviews, workspaceId, pull, repoRow);
        return { diff, repo: `${repoRow.owner}/${repoRow.name}` };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Agent eval pipeline (L06). Read side (cases, run history) and eval case
 * creation from a decided finding. The runner, scoring and compare land in later
 * stages (specs/eval-pipeline-plan.md). Every method resolves the agent / finding
 * in the caller's workspace first, so a foreign id is a 404 (no existence leak).
 */
export class EvalService {
  private store: EvalStore;
  private source: EvalFindingSource;
  private agents: EvalAgentSource;
  private llm: (provider: Provider) => Promise<LLMProvider>;
  private runner: { execute(job: EvalRunJob): Promise<unknown> };
  private now: () => number;

  constructor(container: Container, opts: EvalServiceOptions = {}) {
    this.store = opts.store ?? new EvalRepository(container.db);
    this.source = opts.source ?? reviewsSource(container);
    this.agents = opts.agents ?? container.agentsRepo;
    this.llm = opts.llm ?? ((provider) => container.llm(provider));
    this.now = opts.now ?? Date.now;
    this.runner =
      opts.runner ??
      new EvalRunner({
        llm: this.llm,
        sink: {
          finalize: (runId, final, rows) => this.store.finalizeAgentEvalRun(runId, final, rows),
          isRunning: (runId) => this.store.isAgentEvalRunRunning(runId),
        },
      });
  }

  private async requireAgent(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.store.getAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  async listCases(workspaceId: string, agentId: string): Promise<AgentEvalCase[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.store.listAgentEvalCases(workspaceId, agentId);
    const last = await this.store.listLastCaseResults(rows.map((r) => r.id));
    const lastByCase = new Map(last.map((l) => [l.caseId, l]));
    return rows.flatMap((row) => {
      const dto = toAgentEvalCase(row, lastByCase.get(row.id));
      return dto ? [dto] : [];
    });
  }

  async listRuns(workspaceId: string, agentId: string, limit?: number): Promise<AgentEvalRun[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.store.listAgentEvalRuns(
      workspaceId,
      agentId,
      clampLimit(limit, EVAL_RUNS_DEFAULT_LIMIT, EVAL_RUNS_MAX_LIMIT),
    );
    return rows.map(toAgentEvalRun);
  }

  /**
   * `POST /findings/:id/eval-case` (spec §7). The label comes from the stored
   * decision; the diff, PR metadata and expected location are frozen into the
   * case. Validation runs before the transaction; the duplicate / conflict /
   * name checks run under the per-agent lock in `createCaseLocked`.
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    body: CreateEvalCaseFromFinding,
  ): Promise<AgentEvalCase> {
    const ctx = await this.source.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    const kind = labelFromDecision(finding);
    if (!kind) throw evalError('finding_not_decided', 'Accept or dismiss the finding before turning it into an eval case');

    const agentId = review.agentId;
    const agent = agentId ? await this.store.getAgent(workspaceId, agentId) : undefined;
    if (!agentId || !agent) throw evalError('finding_has_no_agent', 'The finding does not belong to an agent of this workspace');

    const range = normalizeRange(finding.startLine, finding.endLine);
    if (!range) throw evalError('location_not_in_diff', 'The finding has no valid line range');
    if (isTooWide(range)) {
      throw evalError('range_too_wide', 'The finding spans too many lines to be a precise eval case', {
        lines: range.hi - range.lo + 1,
      });
    }

    const parsed = EvalExpectation.safeParse({
      kind,
      file: normalizePath(finding.file),
      start_line: range.lo,
      end_line: range.hi,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
    });
    if (!parsed.success) throw evalError('location_not_in_diff', 'The finding location is not a valid eval expectation');
    const expected = parsed.data;

    const loaded = await this.source.loadPullDiff(workspaceId, pull);
    if (!loaded || loaded.diff.files.length === 0) {
      throw evalError('diff_unavailable', 'The pull request diff could not be loaded');
    }
    const { diff, repo } = loaded;
    if (diff.raw.length > EVAL_MAX_DIFF_CHARS) {
      throw evalError('diff_too_large', 'The pull request diff is too large for an eval case', {
        chars: diff.raw.length,
        max: EVAL_MAX_DIFF_CHARS,
      });
    }
    if (!locationInDiff(expected, finding.kind as Parameters<typeof locationInDiff>[1], diff)) {
      throw evalError('location_not_in_diff', 'The finding location does not intersect the pull request diff');
    }

    const inputHash = computeInputHash(diff.raw, pull.title, pull.body);
    const decidedAt = (finding.acceptedAt ?? finding.dismissedAt)!.toISOString();
    const meta = {
      pr_number: pull.number,
      pr_title: pull.title,
      pr_body: pull.body,
      repo,
      base: pull.base,
      head_sha: pull.headSha,
      source_review_id: review.id,
      source_agent_id: agentId,
      source_agent_version: await this.store.agentVersionOfRun(review.runId),
      decided_at: decidedAt,
      diff_stats: diffStats(diff),
    };

    const row = await this.createLocked(
      { workspaceId, agentId, inputHash, findingId },
      ({ existing, sameInput, takenNames }) => {
        if (existing) {
          throw evalError('eval_case_exists', 'This finding is already an eval case', { eval_case_id: existing.id });
        }
        const conflict = findLocationConflict(expected, sameInput);
        if (conflict?.code === 'duplicate_location') {
          throw evalError('duplicate_location', 'An eval case already covers this location', { eval_case_id: conflict.caseId });
        }
        if (conflict?.code === 'conflicting_label') {
          throw evalError('conflicting_label', 'An eval case with the opposite label covers this location', {
            eval_case_id: conflict.caseId,
          });
        }
        return {
          workspaceId,
          ownerKind: 'agent',
          ownerId: agentId,
          name: uniqueCaseName(body.name ?? defaultCaseName(kind, finding.title), takenNames),
          inputDiff: diff.raw,
          inputFiles: null,
          inputMeta: meta,
          expectedOutput: expected,
          notes: body.notes ?? null,
          kind,
          sourceFindingId: findingId,
          inputHash,
          createdAt: new Date(),
        };
      },
    );

    const dto = toAgentEvalCase(row);
    if (!dto) throw new Error('eval case was stored in an unreadable shape');
    return dto;
  }

  /**
   * `POST /agents/:id/eval-runs` (spec §9, §11). Validates and snapshots the
   * agent's CURRENT config (prompt, model, provider, strategy, skill bodies),
   * creates a `running` row and returns it at once; the runner continues in the
   * background (never `container.jobs`, which retries paid calls). Nothing is
   * written when the agent / cases / provider key are not usable.
   */
  async startRun(workspaceId: string, agentId: string, _input: StartEvalRunInput): Promise<AgentEvalRun> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const cases = await this.store.listAgentEvalCases(workspaceId, agentId);
    const groups = groupCases(cases);
    const caseCount = groups.reduce((n, g) => n + g.cases.length, 0);
    if (caseCount === 0) throw evalError('no_eval_cases', 'The agent has no eval cases yet');
    if (caseCount > EVAL_MAX_CASES || groups.length > EVAL_MAX_INPUT_GROUPS) {
      throw evalError('too_many_cases', 'Too many eval cases for one run', {
        cases: caseCount,
        max_cases: EVAL_MAX_CASES,
        inputs: groups.length,
        max_inputs: EVAL_MAX_INPUT_GROUPS,
      });
    }

    // Missing provider key → ConfigError here, before any row is written (AC-EVAL-12).
    await this.llm(agent.provider);

    const skills = await this.agents.effectiveSkills(workspaceId, agentId);
    const config: EvalConfigSnapshot = {
      provider: agent.provider,
      model: agent.model,
      strategy: agent.strategy,
      system_prompt: agent.systemPrompt,
      agent_version: agent.version,
      skills: skills.map((s) => ({ id: s.id, name: s.name, version: s.version, body: s.body })),
      excluded: [...EVAL_EXCLUDED_INPUTS],
    };

    // A `running` row older than EVAL_STALE_RUN_MINUTES that this process is NOT executing
    // lost its process: free the agent. A run still executing here is never failed this way.
    await this.store.failRunningAgentEvalRuns('stale: the run lost its process', {
      agentId,
      startedBefore: new Date(this.now() - EVAL_STALE_RUN_MINUTES * 60_000),
      excludeIds: [...ACTIVE_EVAL_RUNS],
    });
    const running = await this.store.getRunningAgentEvalRun(workspaceId, agentId);
    if (running) {
      throw evalError('eval_run_in_progress', 'An eval run of this agent is already in progress', { eval_run_id: running.id });
    }

    let row;
    try {
      row = await this.store.insertAgentEvalRun({
        workspaceId,
        agentId,
        agentVersion: agent.version,
        configSnapshot: config,
        promptSha: createHash('sha256').update(config.system_prompt).digest('hex'),
        status: 'running',
      });
    } catch (err) {
      // `agent_eval_runs_one_running_uq`: a concurrent start won the race.
      if (isUniqueViolation(err)) throw evalError('eval_run_in_progress', 'An eval run of this agent is already in progress');
      throw err;
    }

    const runId = row.id;
    ACTIVE_EVAL_RUNS.add(runId);
    void this.runner
      .execute({ runId, config, cases })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await this.store.failAgentEvalRun(runId, `runner error: ${message.slice(0, 500)}`).catch(() => undefined);
      })
      .finally(() => ACTIVE_EVAL_RUNS.delete(runId));
    return toAgentEvalRun(row);
  }

  /** `GET /eval-runs/:id` — stored metrics, counts, per-case results and errors. Read-only. */
  async getRun(workspaceId: string, runId: string): Promise<AgentEvalRunDetail> {
    const row = await this.store.getAgentEvalRun(workspaceId, runId);
    if (!row) throw new NotFoundError('Eval run not found');
    return toAgentEvalRunDetail(row, await this.store.listEvalCaseResults(workspaceId, runId));
  }

  /**
   * `GET /eval-runs/compare?base=&head=` (spec §6.2, §12.4). Both runs must be in
   * the caller's workspace (else 404), of the same agent (else 422) and `done`
   * (else 409 — a failed or running run has no comparable metrics). Read-only.
   */
  async compare(workspaceId: string, baseId: string, headId: string): Promise<EvalRunComparison> {
    const [base, head] = await Promise.all([
      this.store.getAgentEvalRun(workspaceId, baseId),
      this.store.getAgentEvalRun(workspaceId, headId),
    ]);
    if (!base || !head) throw new NotFoundError('Eval run not found');
    if (base.agentId !== head.agentId) {
      throw evalError('different_agents', 'Only runs of the same agent can be compared');
    }
    const notDone = [base, head].filter((r) => r.status !== 'done');
    if (notDone.length > 0) {
      throw evalError('run_not_done', 'Only finished (done) runs can be compared', {
        runs: notDone.map((r) => ({ id: r.id, status: r.status })),
      });
    }
    const [baseResults, headResults] = await Promise.all([
      this.store.listEvalCaseResults(workspaceId, base.id),
      this.store.listEvalCaseResults(workspaceId, head.id),
    ]);
    return compareRuns(
      { run: toAgentEvalRun(base), config: parseRunConfig(base), results: toCaseRunResults(baseResults) },
      { run: toAgentEvalRun(head), config: parseRunConfig(head), results: toCaseRunResults(headResults) },
    );
  }

  /** Boot reaper: a `running` eval run lost its process on restart (spec §9). */
  reapInterruptedRuns(): Promise<number> {
    return this.store.failRunningAgentEvalRuns('interrupted: the server restarted during the run');
  }

  /** `createCaseLocked`, with a unique-index race mapped to `eval_case_exists`. */
  private async createLocked(...args: Parameters<EvalStore['createCaseLocked']>) {
    try {
      return await this.store.createCaseLocked(...args);
    } catch (err) {
      if (isUniqueViolation(err)) throw evalError('eval_case_exists', 'This finding is already an eval case');
      throw err;
    }
  }
}

/** Postgres `unique_violation` (23505), raw or wrapped by Drizzle in `cause`. */
function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined);
  return code(err) === '23505' || code((err as { cause?: unknown } | null)?.cause) === '23505';
}
