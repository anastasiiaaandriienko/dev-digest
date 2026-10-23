import { z } from 'zod';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { EvalCaseMeta, EvalCaseResult, Finding } from '@devdigest/shared';
import type { EvalConfigSnapshot, EvalCounts, LLMProvider, Provider } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
import { taskLine } from '../reviews/helpers.js';
import { EVAL_MAX_FINDINGS_PER_GROUP, EVAL_TASK_AUTHOR } from './constants.js';
import { toAgentEvalCase } from './helpers.js';
import type { EvalRunInsert } from './repository.js';
import { scoreSuite, type ScoredCase, type ScoringGroup } from './scoring.js';

/**
 * Eval runner (specs/eval-pipeline.md §9-§10). Runs ONE agent config snapshot
 * over the frozen inputs of its eval cases:
 *  - cases are grouped by `input_hash`; each group is ONE engine call
 *    (`reviewPullRequest` + its grounding gate) on the frozen diff and PR text —
 *    no git, repo-intel, intent, project context, memory or conventions;
 *  - groups run sequentially; the first failure stops the run (no further paid
 *    calls) and the remaining groups are `error`;
 *  - the deterministic scorer turns every group's kept / dropped findings into
 *    case verdicts and run metrics;
 *  - everything needed to re-score (frozen expectation, kept, dropped) is stored
 *    per case in `eval_runs.actual_output`; the final write is one guarded
 *    transaction (see `EvalRunSink`).
 */

/** What one engine call produced for a group (stored with every case of the group). */
export const StoredEngineOutput = z.object({
  status: z.enum(['ok', 'failed']),
  error: z.string().nullable(),
  kept: z.array(Finding),
  dropped: z.array(z.object({ finding: Finding, reason: z.string() })),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int(),
});
export type StoredEngineOutput = z.infer<typeof StoredEngineOutput>;

/** `eval_runs.actual_output` of one case in one run. */
export const StoredCaseOutput = z.object({
  input_hash: z.string(),
  result: EvalCaseResult,
  engine: StoredEngineOutput,
});
export type StoredCaseOutput = z.infer<typeof StoredCaseOutput>;

export interface EvalRunJob {
  runId: string;
  config: EvalConfigSnapshot;
  /** Labeled cases of the agent (as loaded at run start). */
  cases: readonly EvalCaseRow[];
}

/** Terminal values of an `agent_eval_runs` row. */
export interface EvalRunFinal {
  status: 'done' | 'failed';
  error: string | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  counts: EvalCounts;
  costUsd: number | null;
  durationMs: number;
}

/** Persists the result: per-case rows + the run row, only while it is still `running`. */
export interface EvalRunSink {
  finalize(runId: string, final: EvalRunFinal, rows: EvalRunInsert[]): Promise<boolean>;
  /**
   * Is the run still `running`? Asked before every engine (= paid) call: a run that
   * was failed from outside (reaper, another process) stops instead of spending more.
   */
  isRunning?(runId: string): Promise<boolean>;
}

/** Error of the groups left out because the run stopped being `running`. */
export const EVAL_RUN_STOPPED = 'stopped: the run is no longer running';

export interface EvalRunnerDeps {
  llm: (provider: Provider) => Promise<LLMProvider>;
  sink: EvalRunSink;
  /** Clock for durations (injectable for tests). */
  now?: () => number;
}

interface PreparedGroup {
  inputHash: string;
  rows: EvalCaseRow[];
  cases: ScoredCase[];
}

/** Labeled, parseable cases grouped by frozen input, in a stable order. */
export function groupCases(rows: readonly EvalCaseRow[]): PreparedGroup[] {
  const byHash = new Map<string, PreparedGroup>();
  for (const row of rows) {
    const dto = toAgentEvalCase(row);
    if (!dto || row.inputDiff == null) continue; // legacy / unreadable rows are never run
    const g = byHash.get(dto.input_hash) ?? { inputHash: dto.input_hash, rows: [], cases: [] };
    g.rows.push(row);
    g.cases.push({ id: dto.id, name: dto.name, kind: dto.kind, expected: dto.expected });
    byHash.set(dto.input_hash, g);
  }
  return [...byHash.values()].sort((a, b) => (a.inputHash < b.inputHash ? -1 : a.inputHash > b.inputHash ? 1 : 0));
}

const failedOutput = (error: string): StoredEngineOutput => ({
  status: 'failed',
  error,
  kept: [],
  dropped: [],
  tokens_in: 0,
  tokens_out: 0,
  cost_usd: null,
  duration_ms: 0,
});

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 500);

export class EvalRunner {
  private now: () => number;

  constructor(private deps: EvalRunnerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Run, score and persist. Resolves with what was written (or attempted). */
  async execute(job: EvalRunJob): Promise<EvalRunFinal> {
    const started = this.now();
    const groups = groupCases(job.cases);
    const outputs: StoredEngineOutput[] = [];
    let firstError: string | null = null;

    let llm: LLMProvider | null = null;
    try {
      llm = await this.deps.llm(job.config.provider);
    } catch (err) {
      firstError = `provider unavailable: ${errorMessage(err)}`;
    }

    for (const [i, group] of groups.entries()) {
      if (firstError || !llm) {
        outputs.push(failedOutput(firstError ? 'skipped after an earlier failure' : 'provider unavailable'));
        continue;
      }
      if (this.deps.sink.isRunning && !(await this.deps.sink.isRunning(job.runId))) {
        firstError = EVAL_RUN_STOPPED;
        outputs.push(failedOutput(EVAL_RUN_STOPPED));
        continue;
      }
      const out = await this.runGroup(job, group, i, llm);
      outputs.push(out);
      if (out.status === 'failed') firstError = out.error;
    }

    const scoringGroups: ScoringGroup[] = groups.map((g, i) => ({
      diff: parseUnifiedDiff(g.rows[0]!.inputDiff ?? ''),
      cases: g.cases,
      status: outputs[i]!.status,
      kept: outputs[i]!.kept,
      dropped: outputs[i]!.dropped,
    }));
    const score = scoreSuite(scoringGroups);
    const failed = score.failed || firstError !== null;

    const sumOf = (pick: (o: StoredEngineOutput) => number) => outputs.reduce((n, o) => n + pick(o), 0);
    const final: EvalRunFinal = {
      status: failed ? 'failed' : 'done',
      error: failed ? (firstError ?? 'an engine call failed') : null,
      recall: failed ? null : score.recall,
      precision: failed ? null : score.precision,
      citationAccuracy: failed ? null : score.citation_accuracy,
      counts: { ...score.counts, tokens_in: sumOf((o) => o.tokens_in), tokens_out: sumOf((o) => o.tokens_out) },
      // Engine rule: unknown if any call's cost is unknown (a failed call's spend is unknown too).
      costUsd: outputs.length > 0 && outputs.every((o) => o.cost_usd !== null) ? sumOf((o) => o.cost_usd!) : null,
      durationMs: Math.max(0, Math.round(this.now() - started)),
    };

    const resultByCase = new Map(score.results.map((r) => [r.case_id, r]));
    const ranAt = new Date();
    const rows: EvalRunInsert[] = groups.flatMap((g, i) => {
      const engine = outputs[i]!;
      const share = (v: number | null) => (v === null ? null : v / g.rows.length);
      return g.cases.map((c, k) => {
        const result = resultByCase.get(c.id)!;
        const actual: StoredCaseOutput = { input_hash: g.inputHash, result, engine };
        return {
          caseId: g.rows[k]!.id,
          suiteRunId: job.runId,
          ranAt,
          actualOutput: actual,
          pass: result.pass,
          outcome: result.outcome,
          durationMs: Math.round(engine.duration_ms / g.rows.length),
          costUsd: share(engine.cost_usd),
        };
      });
    });

    await this.deps.sink.finalize(job.runId, final, rows);
    return final;
  }

  private async runGroup(job: EvalRunJob, group: PreparedGroup, index: number, llm: LLMProvider): Promise<StoredEngineOutput> {
    const first = group.rows[0]!;
    const meta = EvalCaseMeta.safeParse(first.inputMeta);
    if (!meta.success) return failedOutput('frozen PR metadata is unreadable');
    const diff = parseUnifiedDiff(first.inputDiff ?? '');
    const { config } = job;
    const start = this.now();
    try {
      const outcome = await reviewPullRequest({
        systemPrompt: config.system_prompt,
        model: config.model,
        diff,
        llm,
        strategy: config.strategy,
        // Frozen skills, in the snapshot order (omitted when none).
        ...(config.skills.length > 0
          ? { skills: config.skills.map((s) => ({ name: s.name, version: s.version, body: s.body })) }
          : {}),
        // Frozen PR text only — untrusted; the engine wraps it.
        ...(meta.data.pr_body ? { prDescription: meta.data.pr_body } : {}),
        task: taskLine({ number: meta.data.pr_number, title: meta.data.pr_title, author: EVAL_TASK_AUTHOR }),
        sessionId: `eval:${job.runId}:${index + 1}`,
      });
      const kept = outcome.review.findings;
      const dropped = outcome.dropped;
      const durationMs = Math.max(0, Math.round(this.now() - start));
      if (kept.length + dropped.length > EVAL_MAX_FINDINGS_PER_GROUP) {
        return {
          ...failedOutput(
            `the engine returned ${kept.length + dropped.length} findings (limit ${EVAL_MAX_FINDINGS_PER_GROUP}); not scored`,
          ),
          tokens_in: outcome.tokensIn,
          tokens_out: outcome.tokensOut,
          cost_usd: outcome.costUsd,
          duration_ms: durationMs,
        };
      }
      return {
        status: 'ok',
        error: null,
        kept,
        dropped,
        tokens_in: outcome.tokensIn,
        tokens_out: outcome.tokensOut,
        cost_usd: outcome.costUsd,
        duration_ms: durationMs,
      };
    } catch (err) {
      return { ...failedOutput(errorMessage(err)), duration_ms: Math.max(0, Math.round(this.now() - start)) };
    }
  }
}

/**
 * Rebuild the scorer input of a finished run from what was stored (case rows +
 * per-case results). `scoreSuite(groupsFromStored(...))` must reproduce the
 * stored metrics exactly — the "re-score offline" guarantee (§10).
 */
export function groupsFromStored(cases: readonly EvalCaseRow[], results: readonly EvalRunRow[]): ScoringGroup[] {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const groups = new Map<string, ScoringGroup & { cases: ScoredCase[] }>();
  for (const row of results) {
    const stored = StoredCaseOutput.parse(row.actualOutput);
    const caseRow = caseById.get(row.caseId);
    let g = groups.get(stored.input_hash);
    if (!g) {
      g = {
        diff: parseUnifiedDiff(caseRow?.inputDiff ?? ''),
        cases: [],
        status: stored.engine.status,
        kept: stored.engine.kept,
        dropped: stored.engine.dropped,
      };
      groups.set(stored.input_hash, g);
    }
    const r = stored.result;
    g.cases.push({ id: r.case_id, name: r.case_name, kind: r.kind, expected: r.expected });
  }
  return [...groups.values()];
}
