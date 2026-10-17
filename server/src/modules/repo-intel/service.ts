/**
 * RepoIntelService — T1.1 facade skeleton.
 *
 * Every method returns a DEGRADED-but-valid result (see types.ts header). The
 * only methods that do real work in T1 are:
 *   - `getBlastRadius`: persistent-index walk (pure algorithm in ./blast.ts),
 *     ripgrep fallback when no usable index exists (tagged degraded).
 *   - `getIndexState`: queries `repo_index_state` if the table exists (T2+),
 *     otherwise synthesises a degraded row so callers never throw.
 *
 * Everything else returns `[]` (array methods) or a degraded object literal
 * (object methods). T1.2 wires the astgrep adapter into
 * `getUnresolvedReferences` and (via T1.3) `getCallerSignatures`. T2 fills in
 * the rank-driven methods. T3 unlocks `getCriticalPaths` etc.
 *
 * The constructor takes ONLY a Container. No astgrep / depgraph / tokenizer
 * deps are imported here — those land later and plug into this same shell.
 */
import type { CodeSymbol, RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { extractCrons, extractEndpoints } from '../../adapters/codeindex/extract.js';
import {
  parseImports,
  parseInvocationHeads,
  parseSymbols,
  langForFile,
} from '../../adapters/astgrep/index.js';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { RepoIntelRepository, type FullSymbolRow } from './repository.js';
import {
  buildDownstream,
  sortChangedSymbols,
  spanTouches,
  type BlastRef,
  type SymbolSpan,
} from './blast.js';
import type {
  BlastChangedSymbol,
  BlastResult,
  BlastSymbolImpact,
  DegradedReason,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  SignatureRow,
  SymbolRow,
} from './types.js';
import {
  BFS_DEPTH,
  DEFAULT_REPO_MAP_TOKEN_BUDGET,
  INDEX_JOB_KIND,
  INDEXER_VERSION,
  MAX_CALLERS_PER_SYMBOL,
  REFRESH_JOB_KIND,
  RESYNC_JOB_KIND,
  SUPPORTED_EXT,
} from './constants.js';
import { runFullIndex, type IndexPayload } from './pipeline/full.js';
import { runIncremental } from './pipeline/incremental.js';

/**
 * GLOBALS allowlist — common JS/TS builtins + runtime that appear as bare
 * invocations and are NOT phantoms. Tune for PRECISION (false-positive cost
 * > false-negative cost). Anything we miss here can be added
 * later; everything we include here is widely-used baseline.
 *
 * Kept module-scoped (not re-built per call) so the `.has(name)` lookup stays
 * O(1) on the hot path. The list intentionally errs on the inclusive side for
 * standard globals — better to under-flag than to spam reviewers with noise.
 */
const PHANTOM_GLOBALS_ALLOWLIST: ReadonlySet<string> = new Set([
  // Console / process / runtime
  'console', 'process', 'globalThis', 'require', 'module', 'exports',
  '__dirname', '__filename',
  // Math/JSON
  'Math', 'JSON',
  // Core ctors
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'Promise',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'Proxy', 'Reflect',
  'BigInt',
  // Timers / microtask
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone',
  // Web/Fetch standard
  'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'AbortController', 'AbortSignal', 'Headers', 'Request', 'Response',
  'FormData', 'Blob', 'File', 'FileReader',
  // Node
  'Buffer',
  // Browser globals
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'performance', 'crypto', 'location', 'history',
  // Numeric coercion / URI
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Misc keywords-that-parse-as-identifiers
  'super', 'this', 'arguments', 'undefined', 'NaN', 'Infinity',
  // Test/runtime affordances (vitest/jest globals; harmless to allow)
  'describe', 'it', 'test', 'expect', 'beforeAll', 'beforeEach',
  'afterAll', 'afterEach', 'vi', 'jest',
]);

export class RepoIntelService implements RepoIntel {
  private readonly repo: RepoIntelRepository;

  constructor(private container: Container) {
    this.repo = new RepoIntelRepository(container.db);
  }

  // -------------------------------------------------------------------------
  // Indexing — T2.2 worker. The job handlers (registered via
  // registerIndexJobHandlers below) are the ASYNC entry; these methods are
  // SYNC-from-the-handler (they ARE the handler body). HTTP/Repo callers go
  // through `container.jobs.enqueue(INDEX_JOB_KIND, ...)` so the clone job
  // closes promptly and the index runs in the background.
  // -------------------------------------------------------------------------

  /**
   * Run a full index of the repo INLINE (no enqueue). The job handler for
   * INDEX_JOB_KIND delegates to this, and tests / explicit calls can also
   * use it. The CI runner needs the synchronous variant — long-running CI
   * jobs already have their own time budget and don't want a second queue.
   */
  async indexRepo(repoId: string): Promise<IndexResult> {
    return runFullIndex(this.container, this.repo, { repoId });
  }

  /**
   * Run an incremental refresh INLINE. Same enqueue/inline split as indexRepo.
   * If the persisted state is missing or its `indexerVersion` is stale, this
   * delegates to `runFullIndex` internally.
   */
  async refreshIndex(repoId: string): Promise<IndexResult> {
    return runIncremental(this.container, this.repo, { repoId });
  }

  /**
   * Manual "re-analyze": advance the clone to `origin/<defaultBranch>` (so the
   * index reflects the latest code), then run an incremental refresh. The
   * incremental pass falls back to a full reindex internally when the diff base
   * is unreachable or the indexer version moved, so this is always
   * correct — never a destructive re-clone. Degrades (never throws) when the
   * repo isn't cloned yet or the fetch fails.
   */
  async resyncRepo(repoId: string): Promise<IndexResult> {
    const startedAt = Date.now();
    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) {
      return { status: 'degraded', filesIndexed: 0, filesSkipped: 0, durationMs: Date.now() - startedAt, reason: 'no_clone' };
    }
    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    try {
      await this.container.git.sync(ref, repo.defaultBranch);
    } catch (err) {
      return {
        status: 'degraded',
        filesIndexed: 0,
        filesSkipped: 0,
        durationMs: Date.now() - startedAt,
        reason: `sync_failed:${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return runIncremental(this.container, this.repo, { repoId });
  }

  /**
   * Register the INDEX_JOB_KIND + REFRESH_JOB_KIND handlers on the JobRunner.
   * Mirrors `RepoService.registerCloneJobHandler` so the registration is an
   * explicit one-shot at app startup (`repoIntel/routes.ts` invokes this).
   *
   * The handlers swallow the IndexResult on purpose — JobRunner expects
   * `Promise<void>`. Status/progress is observable via `repo_index_state`.
   */
  registerIndexJobHandlers(): void {
    this.container.jobs.register(INDEX_JOB_KIND, async (payload) => {
      await this.indexRepo((payload as IndexPayload).repoId);
    });
    this.container.jobs.register(REFRESH_JOB_KIND, async (payload) => {
      await this.refreshIndex((payload as IndexPayload).repoId);
    });
    this.container.jobs.register(RESYNC_JOB_KIND, async (payload) => {
      await this.resyncRepo((payload as IndexPayload).repoId);
    });
  }

  /**
   * ALWAYS works. If `repo_index_state` exists and has a row, returns it.
   * Otherwise synthesises a degraded row so callers can branch on `degraded`
   * without ever hitting a thrown error.
   */
  async getIndexState(repoId: string): Promise<IndexState> {
    const persisted = await this.repo.tryGetIndexState(repoId);
    if (persisted) return persisted;
    return {
      repoId,
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 0,
      reason: 'no_data',
      lastIndexedSha: '',
      indexerVersion: INDEXER_VERSION,
      updatedAt: new Date(0),
      degraded: true,
      degradedReason: 'no_data',
    };
  }

  // -------------------------------------------------------------------------
  // Reads.
  // -------------------------------------------------------------------------

  /**
   * Blast radius of a set of changed files. Never throws.
   *
   *   - flag off                    → empty, degraded `flag_off`;
   *   - persistent index full       → precise result (resolved callers, rank,
   *                                   reverse-import BFS to BFS_DEPTH), not degraded;
   *   - persistent index partial    → same walk, degraded `index_partial`;
   *   - no usable index             → ripgrep fallback over the clone: name-matched
   *                                   callers, rank 0, depth 1 only, degraded
   *                                   `no_data` / `index_failed`.
   *
   * Callers are capped at MAX_CALLERS_PER_SYMBOL per changed symbol; the
   * defining file is never a caller. Line numbers refer to `result.ref`.
   *
   * `changedLines` narrows the changed symbols to those whose indexed span
   * overlaps a changed base line (persistent path only: ripgrep symbols have no
   * end line, so the degraded fallback keeps every symbol of a changed file).
   */
  async getBlastRadius(
    repoId: string,
    changedFiles: string[],
    changedLines?: Readonly<Record<string, readonly number[]>>,
  ): Promise<BlastResult> {
    if (!this.container.config.repoIntelEnabled) return emptyBlast('flag_off');
    if (changedFiles.length === 0) return { ...emptyBlast(), degraded: false, reason: undefined };

    const state = await this.repo.tryGetIndexState(repoId);
    if (state && (state.status === 'full' || state.status === 'partial')) {
      return this.persistentBlast(repoId, changedFiles, state, changedLines);
    }
    return this.fallbackBlast(repoId, changedFiles, state?.status === 'failed' ? 'index_failed' : 'no_data');
  }

  /**
   * Persistent-index blast: reads symbols / resolved references / file_rank /
   * file_edges / file_facts straight from Postgres — NO clone parsing.
   *
   * Callers are PRECISE: only references whose `decl_file` resolved to a changed
   * file count. That favours precision over recall — an ambiguous
   * (NULL decl_file) reference is not asserted as a caller.
   */
  private async persistentBlast(
    repoId: string,
    changedFiles: string[],
    state: IndexState,
    changedLines?: Readonly<Record<string, readonly number[]>>,
  ): Promise<BlastResult> {
    const degraded = state.status === 'partial';
    const base = {
      ref: state.lastIndexedSha,
      degraded,
      ...(degraded ? { reason: 'index_partial' as const } : {}),
    };

    const changedSymbols = changedSymbolsFrom(await this.repo.getSymbolRows(repoId, changedFiles), changedLines);
    if (changedSymbols.length === 0) {
      return { changedSymbols, downstream: [], callers: [], impactedEndpoints: [], factsByFile: {}, ...base };
    }

    // A reference inside the defining file is not a caller (and must not seed the BFS).
    const refs = (
      await this.repo.getResolvedCallers(repoId, changedFiles, [...new Set(changedSymbols.map((s) => s.name))])
    ).filter((r) => r.fromPath !== r.declFile);
    const callerFiles = [...new Set(refs.map((r) => r.fromPath))];
    const spansByFile = groupSpans(await this.repo.getSymbolRows(repoId, callerFiles));

    // Reverse import BFS: depth 1 = caller files, each further hop = their importers.
    const importEdges: { fromFile: string; toFile: string }[] = [];
    const reached = new Set(callerFiles);
    let frontier = callerFiles;
    for (let depth = 2; depth <= BFS_DEPTH && frontier.length > 0; depth += 1) {
      const edges = await this.repo.getImporters(repoId, frontier);
      importEdges.push(...edges);
      frontier = [...new Set(edges.map((e) => e.fromFile))].filter((f) => !reached.has(f));
      for (const f of frontier) reached.add(f);
    }

    const factsByFile: Record<string, { endpoints: string[]; crons: string[] }> = {};
    for (const f of await this.repo.getFileFacts(repoId, [...reached])) {
      factsByFile[f.filePath] = { endpoints: f.endpoints, crons: f.crons };
    }

    const downstream = buildDownstream({
      changedSymbols,
      refs,
      spansByFile,
      importEdges,
      factsByFile,
      limit: MAX_CALLERS_PER_SYMBOL,
      maxDepth: BFS_DEPTH,
    });
    return { changedSymbols, ...flatten(downstream), factsByFile, ...base };
  }

  /**
   * Ripgrep fallback over the clone (no usable index): name-matched references,
   * rank 0, no import graph (depth 1 only), endpoints/crons re-extracted from
   * the caller files. Always degraded — never presented as a full analysis.
   */
  private async fallbackBlast(
    repoId: string,
    changedFiles: string[],
    reason: DegradedReason,
  ): Promise<BlastResult> {
    const empty = emptyBlast(reason);
    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return empty;
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    let allSymbols: CodeSymbol[];
    try {
      allSymbols = await this.container.codeIndex.symbols(ref);
    } catch {
      return empty;
    }
    const changedSet = new Set(changedFiles);
    const changedSymbols = sortChangedSymbols(
      dedupeSymbols(
        allSymbols
          .filter((s) => changedSet.has(s.path) && !s.name.includes('.'))
          .map((s) => ({ file: s.path, name: s.name, kind: s.kind, line: s.line })),
      ),
    );

    const refs: BlastRef[] = [];
    for (const sym of changedSymbols) {
      let found;
      try {
        found = await this.container.codeIndex.references(ref, sym.name);
      } catch {
        continue;
      }
      for (const r of found) {
        refs.push({ fromPath: r.fromPath, toSymbol: sym.name, declFile: sym.file, line: r.line, rank: 0 });
      }
    }

    const spansByFile = new Map<string, SymbolSpan[]>();
    for (const s of allSymbols) {
      const span = { name: s.name, line: s.line, endLine: null };
      const arr = spansByFile.get(s.path);
      if (arr) arr.push(span);
      else spansByFile.set(s.path, [span]);
    }

    const factsByFile: Record<string, { endpoints: string[]; crons: string[] }> = {};
    for (const file of new Set(refs.map((r) => r.fromPath))) {
      const content = await readClone(repo.clonePath, file);
      if (content) factsByFile[file] = { endpoints: extractEndpoints(content), crons: extractCrons(content) };
    }

    const downstream = buildDownstream({
      changedSymbols,
      refs,
      spansByFile,
      importEdges: [],
      factsByFile,
      limit: MAX_CALLERS_PER_SYMBOL,
      maxDepth: BFS_DEPTH,
    });
    const head = await this.container.git.currentHead(ref).catch(() => '');
    return { changedSymbols, ...flatten(downstream), ref: head, degraded: true, reason };
  }

  /**
   * Serve the cached repo-map for the repo's last-indexed SHA. The map is only
   * rendered by the pipeline at `DEFAULT_REPO_MAP_TOKEN_BUDGET`; other budgets
   * (or an unindexed / partial-without-rank repo) miss and degrade cleanly.
   */
  async getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult> {
    const degraded: RepoMapResult = {
      text: '',
      tokens: 0,
      cached: false,
      degraded: true,
      reason: 'no_data',
    };
    if (!this.container.config.repoIntelEnabled) {
      return { ...degraded, reason: 'flag_off' };
    }
    const state = await this.repo.tryGetIndexState(repoId);
    if (!state || !state.lastIndexedSha) return degraded;
    const budget = tokenBudget ?? DEFAULT_REPO_MAP_TOKEN_BUDGET;
    const hit = await this.repo.getRepoMapCache(repoId, state.lastIndexedSha, budget);
    if (!hit) return degraded;
    return { text: hit.mapText, tokens: hit.tokenCount, cached: true };
  }

  /** Percentile per path from `file_rank` (smart-diff / run-executor "top-N%"). */
  async getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (paths.length === 0) return [];
    return this.repo.getFileRankFor(repoId, paths);
  }

  /** Persistent symbol read-model (T2 columns) for the given files. */
  async getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (paths.length === 0) return [];
    const rows = await this.repo.getSymbolRows(repoId, paths);
    return rows.map((r) => ({
      file: r.path,
      name: r.name,
      kind: r.kind,
      exported: r.exported,
      startLine: r.line ?? 0,
      endLine: r.endLine ?? r.line ?? 0,
      signature: r.signature,
    }));
  }

  /**
   * T1.3 — diff-scoped, best-effort callers-in-prompt fuel.
   *
   * For each symbol declared in a changed file (astgrep parseSymbols), find
   * cross-file callers via the EXISTING ripgrep-backed `container.codeIndex.
   * references()` (the same path blast already trusts), then label each caller
   * with its enclosing symbol + signature (astgrep parseSymbols of the caller
   * file). rank=0 until T3 wires file_rank.
   *
   * Skips type/interface symbols (no call sites). Returns at most `limit` rows,
   * deduped by (file, symbol, viaSymbol). Degraded gate: flag off, missing
   * clone, or empty input → `[]`.
   */
  async getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit: number = MAX_CALLERS_PER_SYMBOL,
  ): Promise<SignatureRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (changedFiles.length === 0) return [];

    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return [];

    // 1. Symbols declared in changed files. Filter to symbols that can BE
    //    called (function / method / class). Type/interface aliases have no
    //    call sites, so chasing references for them just wastes work.
    const declaredSymbols = new Map<string, { file: string; kind: string }>();
    for (const file of changedFiles) {
      if (!langForFile(file)) continue;
      const source = await readClone(repo.clonePath, file);
      if (source == null) continue;
      try {
        for (const s of parseSymbols(file, source)) {
          if (s.kind !== 'function' && s.kind !== 'method' && s.kind !== 'class') continue;
          // Dual-emit (Class.method + method): only store the bare name; the
          // qualified form would double-count callers.
          if (s.name.includes('.')) continue;
          if (!declaredSymbols.has(s.name)) {
            declaredSymbols.set(s.name, { file, kind: s.kind });
          }
        }
      } catch {
        // skip unparseable files — diff-scoped, never throw
      }
    }
    if (declaredSymbols.size === 0) return [];

    const ref: RepoRef = { owner: repo.owner, name: repo.name };
    const out: SignatureRow[] = [];
    const seen = new Set<string>();
    // Cache caller-file astgrep parses so we don't re-parse the same file per
    // referenced symbol.
    const callerSymbolsByFile = new Map<string, ReturnType<typeof parseSymbols>>();

    for (const [symbolName, decl] of declaredSymbols) {
      if (out.length >= limit) break;
      let refs;
      try {
        refs = await this.container.codeIndex.references(ref, symbolName);
      } catch {
        continue;
      }
      for (const r of refs) {
        if (out.length >= limit) break;
        if (r.fromPath === decl.file) continue; // skip self-references

        // Parse the caller file once; reuse for further symbols in this loop.
        let callerSyms = callerSymbolsByFile.get(r.fromPath);
        if (callerSyms === undefined) {
          if (!langForFile(r.fromPath)) {
            callerSymbolsByFile.set(r.fromPath, []);
            callerSyms = [];
          } else {
            const callerSrc = await readClone(repo.clonePath, r.fromPath);
            if (callerSrc == null) {
              callerSymbolsByFile.set(r.fromPath, []);
              callerSyms = [];
            } else {
              try {
                callerSyms = parseSymbols(r.fromPath, callerSrc);
              } catch {
                callerSyms = [];
              }
              callerSymbolsByFile.set(r.fromPath, callerSyms);
            }
          }
        }

        // Pick the enclosing top-level symbol (largest line ≤ ref.line, no
        // qualified names — match blast/helpers.ts callerName behavior).
        const enclosing = (callerSyms ?? [])
          .filter((s) => s.line <= r.line && !s.name.includes('.'))
          .sort((a, b) => b.line - a.line)[0];
        if (!enclosing) continue; // no enclosing symbol → no signature to emit
        const signature = enclosing.signature;
        if (!signature) continue;

        const dedupKey = `${r.fromPath}|${enclosing.name}|${symbolName}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        out.push({
          file: r.fromPath,
          symbol: enclosing.name,
          signature,
          rank: 0, // enriched from file_rank below (T3)
        });
      }
    }

    // T3: enrich each caller with its file's rank percentile so the prompt can
    // lead with the most important callers. No-op when no index exists yet.
    if (out.length > 0) {
      const files = [...new Set(out.map((o) => o.file))];
      const ranks = await this.repo.getFileRankFor(repoId, files);
      if (ranks.length > 0) {
        const byFile = new Map(ranks.map((r) => [r.path, r.percentile]));
        for (const o of out) o.rank = byFile.get(o.file) ?? 0;
        out.sort((a, b) => b.rank - a.rank);
      }
    }

    return out;
  }

  /**
   * T1.3 — diff-scoped phantom-API gate fuel.
   *
   * For each changed file: collect bare invocation heads (astgrep
   * parseInvocationHeads). A head is PHANTOM iff it is NOT declared in this
   * file, NOT imported in this file, NOT a JS/TS keyword, and NOT a known
   * runtime/builtin global. `declFile` is intentionally `null` in T1 — Tier 1
   * is ephemeral (no persistent decl_file column; that lands in T2).
   *
   * Degraded gate: flag off, missing clone, or no parseable files → `[]`.
   * NEVER throws — per-file parse errors are swallowed.
   */
  async getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (files.length === 0) return [];

    const repo = await this.repo.getRepoBasics(repoId);
    if (!repo || !repo.clonePath) return [];

    const out: RefRow[] = [];

    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (!(SUPPORTED_EXT as readonly string[]).includes(ext)) continue;

      const source = await readClone(repo.clonePath, file);
      if (source == null) continue;

      let declared: ReturnType<typeof parseSymbols>;
      let imports: ReturnType<typeof parseImports>;
      let heads: ReturnType<typeof parseInvocationHeads>;
      try {
        declared = parseSymbols(file, source);
        imports = parseImports(file, source);
        heads = parseInvocationHeads(file, source);
      } catch {
        // Tree-sitter is lenient but a napi-level failure shouldn't blow up
        // the whole gate. Skip the file (= "no phantoms here" — conservative).
        continue;
      }

      // Build the "declared-or-imported" name set. parseSymbols already emits
      // both qualified (`Class.method`) and bare (`method`) forms, so a method
      // declared anywhere in the file is resolvable as the bare invocation.
      const knownNames = new Set<string>();
      for (const s of declared) knownNames.add(s.name);
      for (const i of imports) knownNames.add(i.name);

      for (const head of heads) {
        if (knownNames.has(head.name)) continue;
        if (PHANTOM_GLOBALS_ALLOWLIST.has(head.name)) continue;
        out.push({
          refFile: file,
          refLine: head.line,
          symbolName: head.name,
          declFile: null, // T1: ephemeral
        });
      }
    }

    return out;
  }

  /** Top-N files by rank, minus tests/configs/migrations — conventions sample. */
  async getConventionSamples(repoId: string, n: number): Promise<string[]> {
    return this.getTopFilesByRank(repoId, n);
  }

  /**
   * Top-N file paths by rank DESC, dropping tests/configs/migrations and any
   * caller-supplied `exclude` substrings. Over-fetches by 10× before filtering
   * so the post-filter still yields N where possible.
   */
  async getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]> {
    if (!this.container.config.repoIntelEnabled) return [];
    if (n <= 0) return [];
    const exclude = opts?.exclude ?? [];
    const rows = await this.repo.getRankedPaths(repoId, Math.max(n * 10, 100));
    const out: string[] = [];
    for (const r of rows) {
      if (isJunkPath(r.path)) continue;
      if (exclude.some((e) => r.path.includes(e))) continue;
      out.push(r.path);
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * Dependency chains from the highest-ranked files (onboarding reading-path).
   * For each of the top roots, greedily follow the highest-ranked import target
   * up to BFS_DEPTH hops. Pure read over `file_edges` + `file_rank`.
   */
  async getCriticalPaths(repoId: string): Promise<string[][]> {
    if (!this.container.config.repoIntelEnabled) return [];
    const edges = await this.repo.getEdges(repoId);
    if (edges.length === 0) return [];

    const ranked = await this.repo.getRankedPaths(repoId, 100_000);
    const rankOf = new Map(ranked.map((r) => [r.path, r.rank]));

    // Adjacency importer → imported.
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const arr = adj.get(e.fromFile);
      if (arr) arr.push(e.toFile);
      else adj.set(e.fromFile, [e.toFile]);
    }

    const roots = ranked.slice(0, CRITICAL_PATH_ROOTS).map((r) => r.path);
    const paths: string[][] = [];
    const seenPaths = new Set<string>();
    for (const root of roots) {
      const chain = [root];
      const inChain = new Set(chain);
      let cur = root;
      for (let depth = 0; depth < BFS_DEPTH; depth += 1) {
        const next = (adj.get(cur) ?? [])
          .filter((t) => !inChain.has(t))
          .sort((a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0))[0];
        if (!next) break;
        chain.push(next);
        inChain.add(next);
        cur = next;
      }
      if (chain.length < 2) continue;
      const key = chain.join('>');
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      paths.push(chain);
    }
    return paths;
  }
}

/** How many top-ranked files seed `getCriticalPaths` dependency chains. */
const CRITICAL_PATH_ROOTS = 5;

/**
 * Path kinds excluded from rank-driven file samples (conventions/onboarding):
 * tests, configs, declaration files, migrations, generated dirs. Substring
 * match on the repo-relative path (kept deliberately simple + deterministic).
 */
const JUNK_PATH_PATTERNS = [
  '.test.',
  '.spec.',
  '.d.ts',
  '__tests__/',
  '__mocks__/',
  '/test/',
  '/tests/',
  '/migrations/',
  '/__fixtures__/',
  '.config.',
  'vitest.',
  'jest.',
  'eslint',
  'prettier',
] as const;

function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATH_PATTERNS.some((p) => lower.includes(p));
}

// ---------------------------------------------------------------------------
// Blast helpers (row shaping only; the walk itself lives in ./blast.ts).
// ---------------------------------------------------------------------------

/** Empty blast result; degraded with `reason` unless the caller overrides it. */
function emptyBlast(reason: DegradedReason = 'no_data'): BlastResult {
  return { changedSymbols: [], downstream: [], callers: [], impactedEndpoints: [], ref: '', degraded: true, reason };
}

/**
 * Changed symbols from persistent rows: bare names only, deduped, sorted. With
 * `changedLines`, a file that has an entry keeps only the symbols whose span
 * overlaps one of its changed lines; a file without an entry keeps them all.
 */
function changedSymbolsFrom(
  rows: FullSymbolRow[],
  changedLines?: Readonly<Record<string, readonly number[]>>,
): BlastChangedSymbol[] {
  return sortChangedSymbols(
    dedupeSymbols(
      rows
        .filter((s) => !s.name.includes('.'))
        .filter((s) => {
          const lines = changedLines?.[s.path];
          return lines === undefined || spanTouches(s, lines);
        })
        .map((s) => ({ file: s.path, name: s.name, kind: s.kind, line: s.line ?? 0 })),
    ),
  );
}

/** One entry per (file, name): the earliest declaration wins. */
function dedupeSymbols(symbols: BlastChangedSymbol[]): BlastChangedSymbol[] {
  const byKey = new Map<string, BlastChangedSymbol>();
  for (const s of symbols) {
    const key = `${s.file}\u0000${s.name}`;
    const prev = byKey.get(key);
    if (!prev || s.line < prev.line) byKey.set(key, s);
  }
  return [...byKey.values()];
}

function groupSpans(rows: FullSymbolRow[]): Map<string, SymbolSpan[]> {
  const byFile = new Map<string, SymbolSpan[]>();
  for (const r of rows) {
    const span = { name: r.name, line: r.line, endLine: r.endLine };
    const arr = byFile.get(r.path);
    if (arr) arr.push(span);
    else byFile.set(r.path, [span]);
  }
  return byFile;
}

/** Flat `callers` / `impactedEndpoints` views of the per-symbol impact. */
function flatten(
  downstream: BlastSymbolImpact[],
): Pick<BlastResult, 'downstream' | 'callers' | 'impactedEndpoints'> {
  const endpoints = new Set<string>();
  for (const d of downstream) for (const e of d.endpoints) endpoints.add(e);
  return {
    downstream,
    callers: downstream.flatMap((d) => d.callers),
    impactedEndpoints: [...endpoints].sort(),
  };
}

async function readClone(clonePath: string, file: string): Promise<string | null> {
  return readFile(join(clonePath, file), 'utf8').catch(() => null);
}
