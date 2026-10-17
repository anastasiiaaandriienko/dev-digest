# repo-intel: capabilities and graceful degradation

[../src/modules/repo-intel/README.md](../src/modules/repo-intel/README.md) has the
overview and the pipeline diagram; this page doesn't repeat them. It covers what a
feature author needs: what each facade method returns, when it is triggered, its
limits, and how it degrades. Verified against
`src/modules/repo-intel/{service,constants}.ts` and `pipeline/*` on 2026-10-11.

Always read through `container.repoIntel` (interface in `src/modules/repo-intel/types.ts`).
Never import pipeline internals and never re-index from a feature.

## When indexing runs (implemented)

Indexing runs as `JobRunner` jobs. The handlers are registered once by
`RepoIntelService.registerIndexJobHandlers()`, which `repo-intel/routes.ts` calls.

| Trigger | Job kind | Work |
|---|---|---|
| clone finished (`src/modules/repos/service.ts:68`) | `repo-intel-index` | `runFullIndex` (`pipeline/full.ts:71`) |
| repo refresh (`src/modules/repos/service.ts:129`) | `repo-intel-refresh` | `runIncremental` (`pipeline/incremental.ts:52`) |
| `POST /repos/:id/resync` | `repo-intel-resync` | git sync, then incremental |

`runIncremental` falls back to a full index in any of these cases:
- there is no state row;
- `INDEXER_VERSION` changed;
- `git diff` fails (for example a shallow clone or a missing base);
- more than 300 files changed.

Status is written to `repo_index_state` and read through `getIndexState` or
`GET /repos/:id/index-state`, which drives the "Indexed" badge.

## Limits (`src/modules/repo-intel/constants.ts`)

- **Languages:** only `.ts .tsx .js .jsx .mjs .cjs` files are indexed. Other languages are skipped.
- **Excluded directories:** `node_modules`, `dist`, `build`, `coverage`, `.next`, `out`, `vendor`, `.git`.
- **Size limits:** at most 5000 files; files over 400 KB are skipped; each file gets at most 2 s to parse.
- **Time budget:** a soft budget of 110 s, under the 120 s JobRunner limit. If it
  runs out, the index is saved with status `partial`.
- **Repo map:** the default budget is 1500 tokens (js-tiktoken). Signatures are trimmed to 120 characters.
- **Callers:** at most 20 per symbol by default; the review executor asks for 10.

## Facade

All methods below are **implemented**. "Consumer today" names the code that
currently calls each method.

| Method | Returns | Consumer today | Intended lesson |
|---|---|---|---|
| `getIndexState(repoId)` | `IndexState`; a synthetic `degraded` row when nothing is stored | index-state route | — |
| `getRepoMap(repoId, budget?)` | `{ text, tokens, cached, degraded?, reason? }` | `run-executor.ts:369` | — |
| `getFileRank(repoId, paths)` | `{ path, percentile }[]` | `run-executor.ts:392` (≥ 95 → rank note) | L03 Smart Diff |
| `getCallerSignatures(repoId, files, limit)` | `{ file, symbol, signature, rank }[]` | `run-executor.ts:336` | — |
| `getSymbolsInFiles(repoId, paths)` | symbol rows | — | L03 |
| `getBlastRadius(repoId, files, changedLines?)` | `BlastResult`: changed symbols = symbols of the changed files whose indexed span overlaps a base line the stored patch changes (`changedLines`; a file without a patch keeps all its symbols; the ripgrep fallback ignores it). Per changed symbol (`downstream`) the direct resolved callers (≤ `MAX_CALLERS_PER_SYMBOL` each, defining file excluded) and the endpoints/crons of the files reached by a reverse-import BFS up to `BFS_DEPTH`; `ref` = indexed SHA; `degraded`/`reason`. Walk in `repo-intel/blast.ts` | `blast/service.ts` (`GET /pulls/:id/blast`) | HW-04 |
| `getUnresolvedReferences(repoId, files)` | unresolved call sites in the given files | — | L06 Phantom gate |
| `getConventionSamples(repoId, n)` | top-ranked file paths | — | L02 |
| `getTopFilesByRank(repoId, n, opts)`, `getCriticalPaths(repoId)` | paths / chains | — | L05 onboarding |
| `indexRepo`, `refreshIndex`, `resyncRepo` | `IndexResult` | job handlers | — |

## Graceful degradation (implemented)

- **Global flag.** With `REPO_INTEL_ENABLED=false` (`src/platform/config.ts:79`;
  the default is on), every read returns empty. `getRepoMap` returns
  `degraded: true, reason: 'flag_off'`.
- **Per-agent flag.** When `agent.repoIntel === false`, the review executor skips
  enrichment entirely (`run-executor.ts:168`).
- **Repo not indexed.**
  - `getRepoMap` returns `degraded` with `reason: 'no_data'`.
  - `getIndexState` returns a synthetic degraded row.
  - Array reads return `[]`.
  - `getBlastRadius` falls back to a ripgrep scan of the clone (name-matched callers,
    `rank: 0`, depth 1 only), marked `degraded: true` with `reason: 'no_data'`
    (`'index_failed'` after a failed index). A `partial` index is still walked but
    reported as `index_partial`; with the flag off the result is empty, `flag_off`.
- **Cache misses.** The repo-map cache is keyed by (last indexed SHA, budget). Any
  other budget, or a stale SHA, returns `degraded`; nothing is computed on demand.
- **The review keeps working.** `run-executor.ts` wraps each enrichment in
  try/catch and simply leaves that prompt section out, so an unindexed repo is
  reviewed diff-only.
- **Feature-author rule.** Branch on `degraded` or an empty result. Don't throw,
  and don't assume an index exists.

## Potential bugs and caveats (code reading, not reproduced)

- **Windows path separators.** `RipgrepCodeIndex.symbols/references` now return POSIX
  paths like the walker (`test/codeindex-ripgrep.test.ts`). `grepWithRg` still parses
  `<path>:<line>:` output with a lazy regex that breaks on `D:\…` paths (not used by blast).
- **Endpoint facts are heuristic.** `extractEndpoints` also matches `api.get(…)` calls
  and test `inject` URLs, and misses route registrations split over several lines.
  Blast ignores the facts of test/spec files; the extractor itself is unchanged.
- **Hotness.** It is always 0 on shallow clones, so ranking is PageRank only.
- **dependency-cruiser.** If it fails, the adapter throws, the import graph is
  empty, ranking goes flat and the status becomes `partial` with `graphFailed` in
  the stats (`test/indexer-pipeline.test.ts`). The adapter runs cruise from the clone
  root and returns POSIX paths, so edges match `walkClone` paths on Windows too
  (`test/depgraph.test.ts`); before that fix every edge was dropped on Windows,
  `file_edges` stayed empty and no `references.decl_file` was resolved.
- **`getUnresolvedReferences`.** It works per file, from what is declared or
  imported in that file plus a globals allowlist. Expect false positives.

## Tests

The unit tests, which need no Docker, are:
- `test/astgrep.test.ts`
- `test/indexer-walk.test.ts`
- `test/indexer-pipeline.test.ts`
- `test/repo-intel-rank-map.test.ts`
- `test/repo-intel-facade-degraded.test.ts`
- `test/repo-intel-resync.test.ts`

The integration test is `test/repo-intel-symbol-clamp.it.test.ts`.

See [testing.md](testing.md) for how to run each lane.
