/**
 * Blast radius — pure walk over index rows (no DB, no clone, no adapters).
 *
 * RepoIntelService loads the rows (persistent index or ripgrep fallback) and
 * hands them here, so both paths share one deterministic algorithm:
 *
 *   changed  symbols declared in a changed file whose span overlaps a line the
 *            patch changes (`changedBaseLines` + `spanTouches`); a file without
 *            a known patch keeps all of its symbols;
 *   depth 1  direct callers = references whose `declFile` is the changed
 *            symbol's file (the defining file itself is never a caller);
 *   depth 2+ files that import a caller file (reverse `file_edges`), up to
 *            `maxDepth` (BFS_DEPTH) hops from the changed symbol.
 *
 * Endpoints / crons come from the facts of every file reached at depth 1..maxDepth.
 * Callers are listed for depth 1 only (they have a real file:line); deeper
 * files only widen the endpoint/cron impact.
 */
import type { BlastCallerRow, BlastChangedSymbol, BlastSymbolImpact } from './types.js';

/** A reference that resolved (or, in the fallback, is assumed) to `declFile`. */
export interface BlastRef {
  fromPath: string;
  toSymbol: string;
  declFile: string;
  line: number;
  /** file_rank.rank of `fromPath` (0 when unranked / fallback). */
  rank: number;
}

/** A declared symbol's span inside its file; `endLine` null = unknown. */
export interface SymbolSpan {
  name: string;
  line: number | null;
  endLine: number | null;
}

/** `fromFile` imports `toFile`. */
export interface ImportEdge {
  fromFile: string;
  toFile: string;
}

export interface FileFacts {
  endpoints: string[];
  crons: string[];
}

export interface BuildDownstreamInput {
  changedSymbols: BlastChangedSymbol[];
  refs: BlastRef[];
  spansByFile: ReadonlyMap<string, SymbolSpan[]>;
  /** Reverse-walk edges; empty in the fallback (no graph → depth 1 only). */
  importEdges: ImportEdge[];
  factsByFile: Readonly<Record<string, FileFacts>>;
  /** MAX_CALLERS_PER_SYMBOL. */
  limit: number;
  /** BFS_DEPTH. */
  maxDepth: number;
}

/**
 * Innermost declared symbol whose span contains `line`. Qualified dual-emits
 * (`Class.method`) are skipped — the bare name already covers them. A span
 * with an unknown end counts as open-ended (nearest preceding declaration).
 */
export function enclosingSymbol(spans: readonly SymbolSpan[], line: number): string | null {
  let best: SymbolSpan | null = null;
  for (const s of spans) {
    if (s.name.includes('.') || s.line == null || s.line > line) continue;
    if (s.endLine != null && s.endLine < line) continue;
    if (!best || s.line > best.line! || (s.line === best.line && s.name < best.name)) best = s;
  }
  return best?.name ?? null;
}

/**
 * Old-side (base) line numbers a unified-diff patch actually changes: every
 * deleted line, and for an insertion the base line it follows. Context lines
 * are ignored. The index describes the base side, so these are the lines to
 * intersect with indexed symbol spans. (`parseUnifiedDiff` tracks only new-side
 * lines including context, so it cannot answer this.)
 */
export function changedBaseLines(patch: string): number[] {
  const out = new Set<number>();
  let oldLine = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
    if (header) {
      oldLine = Number(header[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) continue;
    if (line.startsWith('-')) {
      out.add(oldLine);
      oldLine += 1;
    } else if (line.startsWith('+')) {
      out.add(Math.max(oldLine - 1, 1)); // insertion: the base line it follows (or line 1)
    } else {
      oldLine += 1;
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** True when a symbol's span (end unknown → its first line only) contains a changed line. */
export function spanTouches(span: { line: number | null; endLine: number | null }, lines: readonly number[]): boolean {
  if (span.line == null) return false;
  const end = span.endLine ?? span.line;
  return lines.some((l) => l >= span.line! && l <= end);
}

/** Changed symbols in a stable order: file, line, name. */
export function sortChangedSymbols(symbols: BlastChangedSymbol[]): BlastChangedSymbol[] {
  return [...symbols].sort(
    (a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.name, b.name),
  );
}

export function buildDownstream(input: BuildDownstreamInput): BlastSymbolImpact[] {
  const importersOf = new Map<string, Set<string>>();
  for (const e of input.importEdges) {
    if (e.fromFile === e.toFile) continue;
    const set = importersOf.get(e.toFile);
    if (set) set.add(e.fromFile);
    else importersOf.set(e.toFile, new Set([e.fromFile]));
  }

  return input.changedSymbols.map((sym) => {
    const callers = directCallers(sym, input.refs, input.spansByFile);
    const reached = reachFiles(sym.file, callers.map((c) => c.file), importersOf, input.maxDepth);
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const file of reached) {
      // Test files import the code under test and their `app.inject('GET /x')`
      // calls look like route registrations — they are not affected endpoints.
      if (isTestPath(file)) continue;
      const facts = input.factsByFile[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) crons.add(c);
    }
    return {
      name: sym.name,
      file: sym.file,
      callers: callers.slice(0, input.limit),
      callerCount: callers.length,
      endpoints: [...endpoints].sort(cmp),
      crons: [...crons].sort(cmp),
    };
  });
}

/** Distinct (file, enclosing symbol) callers of `sym`, best-ranked first. */
function directCallers(
  sym: BlastChangedSymbol,
  refs: readonly BlastRef[],
  spansByFile: ReadonlyMap<string, SymbolSpan[]>,
): BlastCallerRow[] {
  const byKey = new Map<string, BlastCallerRow>();
  for (const r of refs) {
    if (r.toSymbol !== sym.name || r.declFile !== sym.file) continue;
    if (r.fromPath === sym.file) continue; // the defining file is not a caller
    const symbol =
      enclosingSymbol(spansByFile.get(r.fromPath) ?? [], r.line) ?? basename(r.fromPath);
    const key = `${r.fromPath}\u0000${symbol}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { file: r.fromPath, symbol, viaSymbol: sym.name, line: r.line, rank: r.rank });
    } else {
      prev.line = Math.min(prev.line, r.line);
      prev.rank = Math.max(prev.rank, r.rank);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.rank - a.rank || cmp(a.file, b.file) || a.line - b.line || cmp(a.symbol, b.symbol),
  );
}

/**
 * Files at depth 1..maxDepth: the caller files, then their importers, hop by
 * hop. The defining file is never re-entered.
 */
function reachFiles(
  definingFile: string,
  callerFiles: string[],
  importersOf: ReadonlyMap<string, ReadonlySet<string>>,
  maxDepth: number,
): Set<string> {
  const visited = new Set<string>();
  let frontier = [...new Set(callerFiles)].filter((f) => f !== definingFile);
  for (const f of frontier) visited.add(f);
  for (let depth = 2; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const importer of importersOf.get(file) ?? []) {
        if (importer === definingFile || visited.has(importer)) continue;
        visited.add(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return visited;
}

const TEST_PATH_MARKERS = ['.test.', '.spec.', '__tests__/', '__mocks__/', '/test/', '/tests/', '/e2e/'];

/** Test / spec / e2e files (repo-relative POSIX). */
export function isTestPath(path: string): boolean {
  const p = `/${path.toLowerCase()}`;
  return TEST_PATH_MARKERS.some((m) => p.includes(m));
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
