import type { BlastDegradedReason, BlastRadius, BlastTotals } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';
import { changedBaseLines } from '../repo-intel/blast.js';
import { DEGRADED_NOTES, GITHUB_HOST } from './constants.js';

/**
 * Pure mapping from the repo-intel facade result (camelCase, internal) to the
 * shared `BlastRadius` contract (snake_case). No I/O.
 */

/**
 * Base-side lines each stored patch changes, keyed by path. Files whose patch is
 * missing (GitHub omits very large diffs) get no entry, so all of their symbols
 * stay "changed".
 */
export function changedLinesByFile(files: { path: string; patch: string | null }[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const f of files) {
    if (f.patch) out[f.path] = changedBaseLines(f.patch);
  }
  return out;
}

/** GitHub blob link pinned to `ref`; null when the commit is unknown. */
export function githubBlobUrl(repoFullName: string, ref: string, file: string, line?: number): string | null {
  if (!ref) return null;
  const path = file.split('/').map(encodeURIComponent).join('/');
  const anchor = line && line > 0 ? `#L${line}` : '';
  return `${GITHUB_HOST}/${repoFullName}/blob/${ref}/${path}${anchor}`;
}

export function toBlastRadius(result: BlastResult, repoFullName: string): BlastRadius {
  const link = (file: string, line?: number) => githubBlobUrl(repoFullName, result.ref, file, line);
  const downstream = result.downstream.map((d) => ({
    symbol: d.name,
    file: d.file,
    callers: d.callers.map((c) => ({ name: c.symbol, file: c.file, line: c.line, url: link(c.file, c.line) })),
    caller_count: d.callerCount,
    truncated: d.callerCount > d.callers.length,
    endpoints_affected: d.endpoints,
    crons_affected: d.crons,
  }));
  const totals: BlastTotals = {
    symbols: result.changedSymbols.length,
    callers: result.downstream.reduce((n, d) => n + d.callerCount, 0),
    endpoints: new Set(result.downstream.flatMap((d) => d.endpoints)).size,
    crons: new Set(result.downstream.flatMap((d) => d.crons)).size,
  };
  const reason = result.degraded ? (result.reason ?? 'no_data') : null;
  return {
    changed_symbols: result.changedSymbols.map((s) => ({
      name: s.name,
      file: s.file,
      kind: s.kind,
      line: s.line,
      url: link(s.file, s.line),
    })),
    downstream,
    summary: blastSummary(totals, reason),
    totals,
    degraded: result.degraded ?? false,
    reason,
    source: { repo_full_name: repoFullName, ref: result.ref },
  };
}

/** Empty blast radius for a PR that cannot be analysed (e.g. no stored files). */
export function emptyBlastRadius(repoFullName: string, reason: BlastDegradedReason): BlastRadius {
  const totals: BlastTotals = { symbols: 0, callers: 0, endpoints: 0, crons: 0 };
  return {
    changed_symbols: [],
    downstream: [],
    summary: blastSummary(totals, reason),
    totals,
    degraded: true,
    reason,
    source: { repo_full_name: repoFullName, ref: '' },
  };
}

/**
 * Deterministic one-paragraph summary (no LLM). Callers are direct call sites;
 * endpoints/crons come from the file-level import graph, so they are worded as
 * "potentially affected".
 */
export function blastSummary(totals: BlastTotals, reason: BlastDegradedReason | null): string {
  let text: string;
  if (totals.symbols === 0) {
    text = 'No changed symbols found in the indexed code.';
  } else if (totals.callers === 0) {
    text = `${plural(totals.symbols, 'changed symbol')}, no downstream callers found.`;
  } else {
    text = `${plural(totals.symbols, 'changed symbol')}, ${plural(totals.callers, 'caller')}`;
    const potential: string[] = [];
    if (totals.endpoints > 0) potential.push(plural(totals.endpoints, 'endpoint'));
    if (totals.crons > 0) potential.push(plural(totals.crons, 'cron/job', 'cron/jobs'));
    text += potential.length > 0 ? `; potentially affected: ${potential.join(', ')}.` : '.';
  }
  return reason ? `${text} ${DEGRADED_NOTES[reason]}` : text;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
