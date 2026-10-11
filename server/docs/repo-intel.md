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
| `getBlastRadius(repoId, files)` | `BlastResult` (changed symbols, callers, impacted endpoints, `degraded`) | — | L04 |
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
  - `getBlastRadius` falls back to a ripgrep scan of the clone, marked `degraded: true` with `rank: 0`.
- **Cache misses.** The repo-map cache is keyed by (last indexed SHA, budget). Any
  other budget, or a stale SHA, returns `degraded`; nothing is computed on demand.
- **The review keeps working.** `run-executor.ts` wraps each enrichment in
  try/catch and simply leaves that prompt section out, so an unindexed repo is
  reviewed diff-only.
- **Feature-author rule.** Branch on `degraded` or an empty result. Don't throw,
  and don't assume an index exists.

## Potential bugs and caveats (code reading, not reproduced)

- **Windows path separators.** `src/adapters/codeindex/ripgrep.ts:105,120` return
  `relative(root, file)` without converting to `/`, whereas the walker normalizes
  (`pipeline/walk.ts:119`). On Windows, `getCallerSignatures` can therefore fail to
  skip self-references (`service.ts:505`), and path-keyed lookups can miss.
- **Hotness.** It is always 0 on shallow clones, so ranking is PageRank only.
- **dependency-cruiser.** If it fails, the import graph is empty: ranking goes flat
  and the status becomes `partial`.
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
