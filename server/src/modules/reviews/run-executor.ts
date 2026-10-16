import type { Container } from '../../platform/container.js';
import type { Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { RECONCILE_DEADLINE_MS, REVIEW_STRATEGY } from './constants.js';
import { appliedSkillsLine, planSkills, taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** The success claim found the run no longer `running` (reaped, deleted, …). */
export class RunNotRunningError extends Error {
  constructor(status: string | null) {
    super(`Run is no longer running (status=${status ?? 'missing'})`);
    this.name = 'RunNotRunningError';
  }
}

/** What reconciliation established about a run's terminal state. */
type TerminalOutcome =
  | { kind: 'cancelled' | 'failed' | 'done' | 'missing' }
  | { kind: 'ended'; status: string | null }
  | { kind: 'unknown'; error: string };

/**
 * Reject if `p` has not settled within `ms`. A client-side backstop only: it
 * does not cancel the underlying query (the repository's SET LOCAL timeouts
 * bound it server-side).
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    // Guarded (spec §3.5): a run already cancelled keeps its status, and the
    // buffer trace is written only when this call moved the run to `failed`.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        const r = await withDeadline(
          this.repo.recordRunFailed(runId, { durationMs: 0, error: msg }),
          RECONCILE_DEADLINE_MS,
        ).catch(() => 'noop' as const);
        if (r === 'transitioned') {
          await withDeadline(
            this.repo.insertRunTraceIfAbsent(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed')),
            RECONCILE_DEADLINE_MS,
          ).catch(() => undefined);
        }
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, agent, runId, runLog);
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // HW2 #14/#19/#20 — the agent's skills, read ONCE for this run: linked,
      // enabled for this agent and globally, in agent_skills order. The same
      // snapshot feeds the prompt, the trace and the log line, so a later edit
      // or reorder never changes what this run's trace says it sent.
      const skillPlan = planSkills(await this.agents.effectiveSkills(workspaceId, agent.id), (text) =>
        this.container.tokenizer.count(text),
      );
      runLog.info(appliedSkillsLine(skillPlan));

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Skills go into the SYSTEM message in this order (omitted when none).
        ...(skillPlan.prompt.length > 0 ? { skills: skillPlan.prompt } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
      });
      const { tokensIn, tokensOut, grounding, costUsd } = outcome;

      const keptFindings = outcome.review.findings;

      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // The trace is built BEFORE the transaction, so its log ends here: the
      // "Persisted review" / "Run complete" lines are published only after the
      // commit and are not claimed by the persisted trace (spec §3.6, D1).
      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          findings: keptFindings.length,
          grounding,
          // reviewer-core's figure as is: a number, or null when unknown (never 0).
          cost_usd: costUsd,
        },
        prompt_assembly: {
          ...outcome.assembly,
          // Run-time snapshot of what was applied (ids, names, versions, order,
          // per-block tokens) + the Skills-section-only token count.
          skill_blocks: skillPlan.applied.length > 0 ? skillPlan.applied : null,
          skills_tokens: skillPlan.sectionTokens,
        },
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };

      // ---- ONE transaction: done + review + findings + reviewed sha + trace --
      // `markReviewed` records the commit this review ran against so the PR list
      // can tell reviewed / needs-review (head moved) / stale apart.
      const result = await this.repo.finalizeDoneRun({
        runId,
        review: {
          workspaceId,
          prId: pull.id,
          agentId: agent.id,
          runId,
          kind: 'review',
          verdict: outcome.review.verdict,
          summary: outcome.review.summary,
          score: outcome.review.score,
          model: agent.model,
        },
        findings: keptFindings,
        reviewedSha: { prId: pull.id, sha: pull.headSha },
        completion: {
          durationMs,
          tokensIn,
          tokensOut,
          findingsCount: keptFindings.length,
          grounding,
          score: outcome.review.score,
          blockers,
        },
        trace,
      });
      if (!result.finalized) {
        // Lost the claim: the run is no longer `running` (cancelled, reaped or
        // deleted). Nothing was written; reconciliation below decides the rest.
        if (result.currentStatus === 'cancelled') throw new RunCancelledError();
        throw new RunNotRunningError(result.currentStatus);
      }

      // Committed — only now publish success (spec §3.6).
      runLog.result(`Persisted review ${result.review.id} with ${result.findings.length} finding(s)`);
      runLog.info('Run complete; trace persisted');
      this.container.runBus.complete(runId);

      return { review: result.review, findings: result.findings, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel — including an ambiguous commit. The terminal event is
      // chosen from the guarded DB write, never from the exception alone.
      await this.reconcileTerminal(runId, pull, agent, runLog, err, Date.now() - start);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /**
   * Persist the terminal state of a run that did not finish successfully, then
   * publish the matching event and (if this call wrote the state) the buffer
   * trace. Guarded: never rewrites a terminal status, so a run whose success
   * transaction actually committed stays `done` with its trace. Bounded by
   * RECONCILE_DEADLINE_MS (plus per-statement DB timeouts in the repository).
   * Spec §3.5–§3.7.
   */
  private async reconcileTerminal(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    runLog: RunLogger,
    err: unknown,
    durationMs: number,
  ): Promise<void> {
    const cancelled = err instanceof RunCancelledError;
    const msg = cancelled ? 'Cancelled by user' : (err as Error).message;

    let outcome: TerminalOutcome;
    try {
      outcome = await withDeadline(
        this.settleTerminal(runId, cancelled, msg, durationMs),
        RECONCILE_DEADLINE_MS,
      );
    } catch (e) {
      outcome = { kind: 'unknown', error: (e as Error).message };
    }

    switch (outcome.kind) {
      case 'cancelled':
        runLog.error('Run cancelled by user');
        break;
      case 'failed':
        runLog.error(`Run failed: ${msg}`);
        break;
      case 'done':
        runLog.info('Run complete (confirmed after a persistence error)');
        break;
      case 'ended':
        runLog.info(`Run already ended with status ${outcome.status ?? 'unknown'}`);
        break;
      case 'missing':
        runLog.info('Run no longer exists');
        break;
      case 'unknown':
        runLog.error(`Run outcome unknown: ${outcome.error}`);
        break;
    }

    // Only when THIS call wrote the terminal state; built after the event above
    // so the persisted log ends with it. Insert-only: never replaces a trace.
    if (outcome.kind === 'cancelled' || outcome.kind === 'failed') {
      const trace = this.traceFromBuffer(runId, pull, agent, '0/0 passed', durationMs);
      await withDeadline(this.repo.insertRunTraceIfAbsent(runId, trace), RECONCILE_DEADLINE_MS).catch(
        () => undefined,
      );
    }
  }

  /** The DB half of reconcileTerminal: guarded write, then (if no-op) a status read. */
  private async settleTerminal(
    runId: string,
    cancelled: boolean,
    msg: string,
    durationMs: number,
  ): Promise<TerminalOutcome> {
    if (cancelled) {
      const r = await this.repo.recordRunCancelled(runId, { durationMs });
      if (r !== 'noop') return { kind: 'cancelled' };
    } else {
      const r = await this.repo.recordRunFailed(runId, { durationMs, error: msg });
      if (r === 'transitioned') return { kind: 'failed' };
    }
    const current = await this.repo.getRunStatus(runId);
    if (!current) return { kind: 'missing' };
    if (current.status === 'done') return { kind: 'done' };
    if (current.status === 'cancelled' && !cancelled) {
      // Cancelled by the user while this run failed for another reason: keep
      // the status, fill in the cancellation metadata once (spec §3.5 B).
      const r = await this.repo.recordRunCancelled(runId, { durationMs });
      if (r !== 'noop') return { kind: 'cancelled' };
    }
    return { kind: 'ended', status: current.status };
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, findings: 0, grounding, cost_usd: null },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
