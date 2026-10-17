import { z } from 'zod';
import type { ApiBlastRadius } from '../api-schemas.js';
import { fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const GET_BLAST_RADIUS = 'get_blast_radius';

/** Upper bound on changed symbols returned (callers are already capped per symbol by the API). */
const MAX_SYMBOLS = 50;

const CallerOut = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number(),
  url: z.string().nullable(),
});

export const getBlastRadiusInput = {
  pr_id: z.string().uuid().describe('Internal DevDigest pull-request id (uuid), not the GitHub PR number.'),
};
export const getBlastRadiusOutput = {
  pr_id: z.string(),
  summary: z.string(),
  degraded: z.boolean(),
  reason: z.string().nullable(),
  source: z.object({ repo_full_name: z.string(), ref: z.string() }).nullable(),
  totals: z.object({ symbols: z.number(), callers: z.number(), endpoints: z.number(), crons: z.number() }),
  changed_symbols: z.array(
    z.object({ name: z.string(), file: z.string(), kind: z.string(), line: z.number().nullable(), url: z.string().nullable() }),
  ),
  downstream: z.array(
    z.object({
      symbol: z.string(),
      file: z.string().nullable(),
      callers: z.array(CallerOut),
      caller_count: z.number(),
      truncated: z.boolean(),
      endpoints_affected: z.array(z.string()),
      crons_affected: z.array(z.string()),
    }),
  ),
  symbols_truncated: z.boolean(),
};

export const getBlastRadiusConfig = {
  title: 'Get PR blast radius',
  description:
    'Returns the impact map of a PR (GET /pulls/:id/blast): its changed symbols, their direct callers (file:line, GitHub links ' +
    'pinned to the indexed commit, not necessarily the PR head) and the potentially affected endpoints / crons found through the ' +
    'file-level import graph of the repo-intel index. `degraded` + `reason` say when the analysis is partial. ' +
    'Read-only: no GitHub sync, no LLM call, no writes.',
  inputSchema: getBlastRadiusInput,
  outputSchema: getBlastRadiusOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export async function getBlastRadius(deps: ToolDeps, input: { pr_id: string }): Promise<ToolResult> {
  try {
    const blast = await deps.api.getBlastRadius(input.pr_id);
    const structured = toStructured(input.pr_id, blast);
    return ok(toText(structured), structured);
  } catch (err) {
    return fail(err);
  }
}

type Structured = ReturnType<typeof toStructured>;

/** Normalise the API payload (optional HW-04 fields → explicit values) and bound its size. */
function toStructured(prId: string, blast: ApiBlastRadius) {
  const downstream = blast.downstream.slice(0, MAX_SYMBOLS).map((d) => {
    const callerCount = d.caller_count ?? d.callers.length;
    return {
      symbol: d.symbol,
      file: d.file ?? null,
      callers: d.callers.map((c) => ({ name: c.name, file: c.file, line: c.line, url: c.url ?? null })),
      caller_count: callerCount,
      truncated: d.truncated ?? callerCount > d.callers.length,
      endpoints_affected: d.endpoints_affected,
      crons_affected: d.crons_affected,
    };
  });
  const totals = blast.totals ?? {
    symbols: blast.changed_symbols.length,
    callers: blast.downstream.reduce((n, d) => n + (d.caller_count ?? d.callers.length), 0),
    endpoints: new Set(blast.downstream.flatMap((d) => d.endpoints_affected)).size,
    crons: new Set(blast.downstream.flatMap((d) => d.crons_affected)).size,
  };
  const degraded = blast.degraded ?? false;
  return {
    pr_id: prId,
    summary: blast.summary,
    degraded,
    reason: degraded ? (blast.reason ?? 'no_data') : null,
    source: blast.source ?? null,
    totals,
    changed_symbols: blast.changed_symbols.slice(0, MAX_SYMBOLS).map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
      line: s.line ?? null,
      url: s.url ?? null,
    })),
    downstream,
    symbols_truncated: blast.changed_symbols.length > MAX_SYMBOLS || blast.downstream.length > MAX_SYMBOLS,
  };
}

/** Compact text for the model: summary, caveats, then symbol → callers → potentially affected endpoints/crons. */
function toText(s: Structured): string {
  const lines = [s.summary];
  if (s.degraded) lines.push(`Partial analysis (reason: ${s.reason}).`);
  if (s.source?.ref) {
    lines.push(
      `Source: ${s.source.repo_full_name}@${s.source.ref.slice(0, 7)} — lines refer to the indexed commit, which may differ from the PR head.`,
    );
  }
  for (const d of s.downstream) {
    lines.push(`- ${d.symbol}${d.file ? ` (${d.file})` : ''}: ${d.caller_count} caller(s)${d.truncated ? `, showing ${d.callers.length}` : ''}`);
    for (const c of d.callers) lines.push(`  ↳ ${c.file}:${c.line} (${c.name})`);
    if (d.endpoints_affected.length > 0) lines.push(`  potentially affected endpoints: ${d.endpoints_affected.join(', ')}`);
    if (d.crons_affected.length > 0) lines.push(`  potentially affected crons/jobs: ${d.crons_affected.join(', ')}`);
  }
  if (s.symbols_truncated) lines.push(`Only the first ${MAX_SYMBOLS} changed symbols are listed.`);
  return lines.join('\n');
}
