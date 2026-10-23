import type { Container } from '../../platform/container.js';
import type { FindingActionKind, RunEventKind, RunTrace, SmartDiff } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository, type PullRow } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { MultiRunRepository } from './multi-run/repository.js';
import { isAgentId } from './multi-run/helpers.js';
import { IntentService } from './intent/service.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';
import { buildSmartDiff } from './smart-diff.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/** One queued agent run handed to the executor. */
type RunJob = { agent: AgentRow; runId: string };
/** `runs[]` entry of POST /pulls/:id/review (ReviewRunTarget). */
type RunTargetDto = { run_id: string; agent_id: string; agent_name: string };
const toRunTarget = ({ agent, runId }: RunJob): RunTargetDto => ({
  run_id: runId,
  agent_id: agent.id,
  agent_name: agent.name,
});

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private repo: ReviewRepository;
  private multiRuns: MultiRunRepository;
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    this.multiRuns = new MultiRunRepository(container.db);
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents, new IntentService(container), container.contextStore ?? undefined);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<AgentRow[]> {
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId or all:true', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /**
   * Delete one run from the history (+ its trace). A CI run (`source='ci'`) is
   * refused with 409 BEFORE any delete (AC-MAR-59): GitHub is its source of
   * truth, and deleting it would cascade to `ci_runs` so the next sync would
   * re-ingest it. The check is workspace-scoped, so a foreign run reads as
   * missing and gets the usual `false` (→ `{ ok: false }`), never the 409.
   */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    if ((await this.repo.getRunSource(workspaceId, runId)) === 'ci') {
      throw new AppError('ci_run_not_deletable', 'CI runs cannot be deleted from the studio', 409);
    }
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapStaleRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{ runs: RunTargetDto[]; reviews: ReviewDto[] }> {
    const { pull, repo } = await this.loadPullAndRepo(workspaceId, prId);

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const jobs: RunJob[] = [];
    for (const agent of targets) {
      const runId = await this.repo.createAgentRun({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      });
      jobs.push({ agent, runId });
    }

    this.launch(workspaceId, pull, repo, jobs, logger);
    return { runs: jobs.map(toRunTarget), reviews: [] };
  }

  /**
   * L07 multi-agent run (AC-MAR-01/02/53): validate every agent and the PR
   * BEFORE any write, then create the `multi_agent_runs` parent and one child
   * run per agent (list order) in ONE transaction, and only after it commits
   * start the same background execution as `runReview`. `agentIds` comes from
   * `normalizeAgentIds` (distinct, 1..8, list order kept).
   */
  async runMultiAgentReview(
    workspaceId: string,
    prId: string,
    agentIds: readonly string[],
    logger?: Logger,
  ): Promise<{ multiAgentRunId: string; runs: RunTargetDto[]; reviews: ReviewDto[] }> {
    const targets: AgentRow[] = [];
    for (const id of agentIds) {
      const agent = isAgentId(id) ? await this.agents.getById(workspaceId, id) : undefined;
      if (!agent) throw new NotFoundError('Agent not found');
      targets.push(agent);
    }
    const { pull, repo } = await this.loadPullAndRepo(workspaceId, prId);

    // Atomic: the parent and every child, or nothing (rollback on any error).
    const { multiAgentRunId, runIds } = await this.multiRuns.createMultiRun({
      workspaceId,
      prId,
      agents: targets,
    });
    const jobs = targets.map((agent, i) => ({ agent, runId: runIds[i]! }));

    // Committed — only now hand the runs to the executor.
    this.launch(workspaceId, pull, repo, jobs, logger);
    return { multiAgentRunId, runs: jobs.map(toRunTarget), reviews: [] };
  }

  /** The PR (workspace-scoped) and its repo, or 404. */
  private async loadPullAndRepo(workspaceId: string, prId: string) {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }

  /**
   * Fire-and-forget: the HTTP response returns now with the runIds; reviews
   * are persisted as each agent finishes and the client refetches on SSE done.
   */
  private launch(
    workspaceId: string,
    pull: PullRow,
    repo: NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>,
    jobs: RunJob[],
    logger?: Logger,
  ): void {
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId: pull.id, err: (err as Error).message }, 'review: background execution crashed');
    });
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    const names = new Map<string, string>();
    for (const { review } of rows) {
      if (review.agentId && !names.has(review.agentId)) {
        const a = await this.agents.getById(workspaceId, review.agentId);
        if (a) names.set(review.agentId, a.name);
      }
    }
    const evalCaseIds = await this.repo.evalCaseIdsForFindings(
      workspaceId,
      rows.flatMap(({ findings }) => findings.map((f) => f.id)),
    );
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null, evalCaseIds),
    );
  }

  /**
   * GET /pulls/:id/smart-diff — the PR's stored files grouped by role (shared
   * classification rules) with inline findings anchored to changed lines and a
   * split suggestion. Local reads only (no GitHub, no LLM); 404 for an unknown
   * or foreign PR.
   */
  async smartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const [files, findings] = await Promise.all([
      this.repo.getPrFiles(prId),
      this.repo.inlineFindings(workspaceId, prId),
    ]);
    return buildSmartDiff(
      files,
      findings.map((f) => ({ file: f.file, start_line: f.startLine, end_line: f.endLine })),
    );
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }
}
