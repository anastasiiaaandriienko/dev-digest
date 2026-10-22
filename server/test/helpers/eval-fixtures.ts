import type {
  CompletionRequest,
  CompletionResult,
  EvalCaseKind,
  Finding,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import type { z } from 'zod';
import type { EvalCaseRow } from '../../src/db/rows.js';
import { computeInputHash } from '../../src/modules/evals/helpers.js';

/**
 * Shared fixtures for the L06 eval runner tests (no network, no paid calls).
 */

/** A diff where each file gains lines 1..n. */
export function addedFileDiff(files: Record<string, number>): string {
  const parts: string[] = [];
  for (const [file, n] of Object.entries(files)) {
    parts.push(`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -0,0 +1,${n} @@`);
    for (let i = 1; i <= n; i++) parts.push(`+line ${i} of ${file}`);
  }
  return parts.join('\n');
}

export function finding(file: string, start: number, end = start, over: Partial<Finding> = {}): Finding {
  return {
    id: `${file}:${start}-${end}`,
    severity: 'WARNING',
    category: 'bug',
    title: `Issue at ${file}:${start}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
    ...over,
  };
}

export function review(findings: Finding[]): Review {
  return { verdict: 'comment', summary: 's', score: 70, findings };
}

/** An `eval_cases` row in the shape Stage 3 writes. */
export function evalCaseRow(o: {
  id: string;
  workspaceId: string;
  agentId: string;
  kind: EvalCaseKind;
  file: string;
  start: number;
  end?: number;
  diff: string;
  prNumber?: number;
  prTitle?: string;
  prBody?: string | null;
}): EvalCaseRow {
  const prTitle = o.prTitle ?? `PR ${o.prNumber ?? 1}`;
  const prBody = o.prBody ?? null;
  return {
    id: o.id,
    workspaceId: o.workspaceId,
    ownerKind: 'agent',
    ownerId: o.agentId,
    name: o.id,
    inputDiff: o.diff,
    inputFiles: null,
    inputMeta: {
      pr_number: o.prNumber ?? 1,
      pr_title: prTitle,
      pr_body: prBody,
      repo: 'acme/app',
      base: 'main',
      head_sha: 'h',
      source_review_id: 'rev',
      source_agent_id: o.agentId,
      source_agent_version: 1,
      decided_at: '2026-10-22T09:00:00.000Z',
      diff_stats: { files: 1, additions: 1, deletions: 0 },
    },
    expectedOutput: {
      kind: o.kind,
      file: o.file,
      start_line: o.start,
      end_line: o.end ?? o.start,
      severity: 'WARNING',
      category: 'bug',
      title: o.id,
    },
    notes: null,
    kind: o.kind,
    sourceFindingId: null,
    inputHash: computeInputHash(o.diff, prTitle, prBody),
    createdAt: new Date('2026-10-22T10:00:00.000Z'),
  };
}

type Step = Review | Error | ((req: StructuredRequest<unknown>) => Review | Error);

/**
 * A scripted structured-output provider for the eval runner. Each
 * `completeStructured` call takes the next step (the last one repeats): a Review
 * fixture, an Error to throw, or a function of the request. Records requests.
 */
export class ScriptedLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  public requests: StructuredRequest<unknown>[] = [];
  private i = 0;

  constructor(
    private steps: Step[],
    private opts: { delayMs?: number; costUsd?: number | null } = {},
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: '', model: req.model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const raw = this.steps[Math.min(this.i++, this.steps.length - 1)]!;
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    const step = typeof raw === 'function' ? raw(req as StructuredRequest<unknown>) : raw;
    if (step instanceof Error) throw step;
    const data = (req.schema as z.ZodType<T>).parse(step);
    return {
      data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 40,
      costUsd: this.opts.costUsd === undefined ? 0.002 : this.opts.costUsd,
      raw: JSON.stringify(step),
      attempts: 1,
    };
  }
}

/**
 * The developer's working database URLs — integration tests must never touch them:
 * DATABASE_URL (dotenv, loaded by config.ts) and, when `verify:l06 --it` replaced
 * DATABASE_URL with an unreachable one, the original in DEVDIGEST_WORKING_DATABASE_URL.
 */
const WORKING_DB_URLS = [process.env.DATABASE_URL, process.env.DEVDIGEST_WORKING_DATABASE_URL].filter(
  (u): u is string => !!u,
);

/** Throws unless `url` is a throwaway (Testcontainers) database, never the working one. */
export function assertThrowawayDb(url: string): void {
  const target = new URL(url);
  for (const workingUrl of WORKING_DB_URLS) {
    const working = new URL(workingUrl);
    if (target.host === working.host && target.pathname === working.pathname) {
      throw new Error(`refusing to run against the working database (${working.host}${working.pathname})`);
    }
  }
  // Testcontainers maps a random host port; the docker-compose DB listens on 5432.
  if (target.port === '5432') throw new Error('refusing to run against port 5432');
}
