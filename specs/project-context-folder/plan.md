# Development Plan — Project Context Folder

- **Status:** Approved (2026-10-18, G2) · Approvals granted: contract change in both vendored copies (#6). Pending: #1–#5.
- **Spec:** `specs/project-context-folder/spec.md` (Key CTX, 76 ACs, Approved 2026-10-18, AC-CTX-46 revised, a95a7f7)
- **Planner:** implementation-planner (opus), MODE PLAN. **Cross-model review:** implementation-planner (sonnet), MODE REVIEW — "approve with changes", all 8 findings applied.
- **Goal:** discover, list, search and preview repo Markdown docs; attach them to agents/skills per repo; inject them at review time as reviewer-core `specs` with deterministic limits and a trace that holds no doc text.

## Technical assumptions (user-confirmed unless marked)

- **TA1** AC-71 baseline: single-pass vs `MockLLMProvider.calls[0].messages[1]`; map-reduce vs `outcome.assembly.user` (whole-diff assembly, `reviewer-core/src/review/run.ts:148-149,180`; spec §2 "as today").
- **TA2** Roots key `context_roots:<repoId>`, value `{ roots: string[] }`, workspace-level (`user_id` NULL). Visible in `GET /settings` (`rowsToSettings`, `server/src/modules/settings/routes.ts:28-34`); no filter. Roots are never written via `PUT /settings`.
- **TA3** Endpoints: `GET|PUT /repos/:id/context/roots`; `GET /repos/:id/context?q=`; `GET /repos/:id/context/file?path=`; `GET|POST /agents/:id/context-docs?repo_id=`, `DELETE /agents/:id/context-docs/:docId`; same three for `/skills/:id/context-docs`.
- **TA4** Attach on an uncloned repo → 422 with `details.reason='repo not cloned'`.
- **TA5** Listed attachment status: `outside_roots` if no current root prefixes the path; else `ok` if lstat finds a regular file; else `missing`.
- **TA6** `loadForRun` throws → log `context: unavailable`, the run continues without context.
- **TA7** AC-73 warning = `runLog.info('context: warning — …')` + `logger.warn` (an `error`-kind line reads as a failed run, `run-executor.ts:143-146`).
- **TA8** Sidebar entry "Project Context" → `/repos/:repoId/context` (`client/src/vendor/ui/nav.ts:21-27`), tied to AC-12.
- **TA9** Run-time and preview reads lstat every parent folder (`readCloneFile` lstats only the last segment, `server/src/modules/conventions/samples.ts:84-89`); enforces §9 "no symlinked directories".
- **TA10** (confirmed) e2e fixtures: `scripts/e2e.sh` creates the fixture clone and exports `SEED_CONTEXT_CLONE_PATH`; `seed.ts` sets the repo `clonePath` and inserts the CTX run/trace only when it is set (dev seed unchanged).
- **TA11** (confirmed, temporary intermediate state only — removed by T6b) Until T6b lands, context routes with no store answer `AppError('CONTEXT_UNAVAILABLE', …, 503)`.

## Architecture

- **Map-reduce redaction.** `outcome.assembly` in map-reduce is built from the same `promptParts` (incl. `specs`) as every chunk (`run.ts:136-149,179`), so `assembly.specs` equals the block sent per chunk and `assembly.user` holds `## Project context\n`+block once (`prompt.ts:234-237,256,264`). It cannot be forged earlier (single-line task, `reviews/helpers.ts:124-133`; earlier blocks escaped by `wrapUntrusted`, `prompt.ts:40-50`). A residual check fails closed if any read entry text remains in persisted `user`/`specs`.
- **Layers.** routes → `ContextService` → `ContextStore` (interface, `context/types.ts`); Drizzle `ContextRepository` in T6b after the approved schema. Tests inject an in-memory store via new `ContainerOverrides.contextStore` (precedent: `repoIntel`/`tokenizer` overrides, `server/src/platform/container.ts:50-53,114-132`). Auth in tests: `MockAuthProvider` (`server/src/adapters/mocks.ts:312`).
- **NEW cross-module dependency** (for architecture-reviewer): `context/read.ts` imports `unsafeRepoPath`, `readCloneFile`, `redactSecrets` from `conventions/samples.ts:41-116` (reused, not copied).
- **Roots upsert.** NULL `user_id` defeats the unique index (`server/src/db/schema/core.ts:41,46`): transaction + `pg_advisory_xact_lock(hashtext(key))`, select `user_id IS NULL` rows, pure `planRootsUpsert(ids)` → update-first / delete-rest / insert. No migration, no partial index.
- **Run time.** `ReviewRunExecutor` optional 5th arg `context?: ProjectContextSource` like `intent` (`run-executor.ts:78-84`), wired in `reviews/service.ts:38` with `container.contextStore ?? undefined`. Context step after `planSkills` (`:281-284`), before `reviewPullRequest` (`:290`); `specs` only when non-empty. Trace (`:350-365`) overrides `specs`/`user` with placeholders and adds `specs_read`, `spec_blocks`, `specs_tokens`, `spec_summary`. `traceFromBuffer` (`:617,621`) and reviewer-core source unchanged.
- **Clone root** = `repos.clonePath` (`conventions/service.ts:77,85`). **Errors:** `AppError('REPO_NOT_CLONED',…,409)`, `ValidationError` 422, `NotFoundError` 404 (`server/src/platform/errors.ts`); `IdParams` (`server/src/modules/_shared/schemas.ts:11`).
- **Contracts, both copies** (only new symbols identical): `platform.ts:302-317` + `ContextList`, `ContextFile`, `ContextRoots(+Update)`, `ContextAttachment`, `ContextAttachRequest`; `trace.ts:52-73` + `SpecBlock`, `SpecSummary`, nullish `PromptAssembly.spec_blocks|specs_tokens|spec_summary`.
- **Client.** New `hooks/context.ts`; old hooks in `client/src/lib/hooks/core.ts:122-137` removed; preview uses `Markdown` (`client/src/vendor/ui/primitives/index.ts:19`); Trace drawer `SpecBlocks` section in `TraceBody.tsx:90-106`.

## Approvals required

1. Schema + migration (T5): `server/src/db/schema/project-context.ts`, `pnpm db:generate` → `0014_*` + `meta/`. `db:migrate` by the user.
2. Integration run (T14).
3. e2e fixture edits: `server/src/db/seed.ts` (T15a), `scripts/e2e.sh` (T15b), `.github/workflows/e2e-web.yml` (T15c, only if CI runs the flow).
4. e2e run (T15d).
5. Paid manual run AC-68 (T16).
6. Contract change in both copies (§16).

No new dependencies; no lockfile changes. Package checks always run one at a time.

## Tasks

Every `it(...)` title starts with its AC-ID. All tasks load `engineering-insights` (read). Server tasks also load `onion-architecture`; client tasks `frontend-architecture`, `react-best-practices`, `react-testing-library`.

Checks: **[S]** `cd server && pnpm typecheck` → `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · **[C]** `cd client && pnpm typecheck && pnpm test` · **[R]** `cd reviewer-core && npm run typecheck && npm test`

### T1 — Contracts (both copies)
- AC: AC-CTX-08, 34, 35, 43, 65 · contracts · implementer · Skills: zod
- Files: M `server/src/vendor/shared/contracts/{platform,trace}.ts` · M `client/src/vendor/shared/contracts/{platform,trace}.ts` · M `server/test/contracts.test.ts`
- Depends on: —
- Steps: TA3 DTOs (list item `path,size,updated_at`, no `content`); status enum `ok|missing|outside_roots`; `SpecBlock`/`SpecSummary` nullish.
- Acceptance: AC-08 no content field; AC-34/35/65 old trace still parses.
- Tests: "AC-CTX-34 PromptAssembly parses with and without spec fields", "AC-CTX-08 ContextList item has no content".
- Checks: [S]; `cd client && pnpm typecheck` · Risks: copies already drift (server INSIGHTS 2026-10-11) — diff only new symbols.
- Commit: C1

### T2 — reviewer-core acceptance tests (no source change)
- AC: AC-CTX-26, 27, 44 · reviewer-core · test-writer · Skills: typescript-expert
- Files: A `reviewer-core/test/project-context.test.ts` (new) · Depends on: —
- Tests: "AC-CTX-26 specs only in user message under Project context", "AC-CTX-27 nested untrusted escaped, one close per wrapper", "AC-CTX-44 fake provider gets marker in spec-0, not in system".
- Checks: [R] (imports server mocks — server must typecheck). Commit: C2

### T3 — Constants and pure helpers
- AC: AC-CTX-03, 04, 32, 49, 50, 57, 67, 76 · server · implementer · Skills: security
- Files: A `server/src/modules/context/{constants,helpers}.ts` (new) · A `server/test/context-helpers.test.ts` (new) · Depends on: —
- Steps: L1–L9, default roots, skip dirs, reason strings, placeholder format, L5 marker, `context_roots:` prefix; `normalizeContextPath` (§9: strip `./`, collapse `//`, drop `.` and trailing `/`, then `unsafeRepoPath`; backslash rejected; case kept); `validateRoots`, `isUnderRoots`, `queryValid`; `planRootsUpsert(existingIds)` → `{updateId, deleteIds, insert}`.
- Tests: "AC-CTX-57 normalizes, case-sensitive", "AC-CTX-04/76 rejects absolute/drive/../\\/control", "AC-CTX-49 rejects 11 roots", "AC-CTX-50 rejects q>200", "AC-CTX-32 rejects .env", "AC-CTX-03 planRootsUpsert: none→insert, one→update, many→update first + delete rest".
- Checks: [S] · Commit: C3

### T4 — Discovery walk and safe read
- AC: AC-CTX-01, 02, 05, 06, 07, 09, 10, 29, 31, 32, 38, 40, 42, 47, 48, 64, 66, 74 · server · implementer · Skills: security
- Files: A `server/src/modules/context/{discovery,read}.ts` (new) · A `server/test/context-discovery.test.ts`, `server/test/context-read.test.ts` (new) · Depends on: T3
- Steps: `walkDocs(cloneRoot, roots, {now})` — DFS pre-order, UTF-16 sort, `.md` only, skip symlinks/`node_modules`/`dist`/dot-dirs, depth 8 / 500 files / 2 s (injected clock), one entry per path across roots. `readContextDoc` — lstat first, ENOENT → `missing` (`readCloneFile` maps ENOENT to `unreadable`, `samples.ts:113-115`); parent lstat (TA9); `readCloneFile(…, 32768)` → `redactSecrets`. `matchesQuery` case-insensitive over path + redacted text.
- Tests (discovery): "AC-CTX-01 order", "AC-CTX-02 default roots", "AC-CTX-05 skip list", "AC-CTX-06 symlinked dir not followed", "AC-CTX-07 file_limit", "AC-CTX-47 depth_limit", "AC-CTX-48 time_limit injected clock", "AC-CTX-42 missing root", "AC-CTX-32 .env not listed". (read): "AC-CTX-66 cut at last newline", "AC-CTX-74 single long line skipped", "AC-CTX-40 binary/non-UTF-8 skipped", "AC-CTX-29 symlink/outside clone skipped", "AC-CTX-31 secrets redacted", "AC-CTX-09 match path or content", "AC-CTX-10 truncated flag", "AC-CTX-38 deleted file -> missing, not unreadable", "AC-CTX-64 PR-head-only doc -> missing".
- Checks: [S] · Risks: Windows symlink privileges → `it.skipIf` with reason. Commit: C4

### T5 — Attachment tables + migration — APPROVAL REQUIRED
- AC: AC-CTX-14, 55, 58, 69 · server · implementer · Skills: drizzle-orm-patterns, postgresql-table-design
- Files: A `server/src/db/schema/project-context.ts` (new) · M `server/src/db/schema.ts` · A `server/src/db/migrations/0014_*.sql` + `meta/*` (generated) · Depends on: approval
- Steps: `agent_context_docs`, `skill_context_docs`: `id`, `workspace_id` FK, `agent_id|skill_id` FK cascade, `repo_id` FK cascade, `path`, `order`, `created_at`; unique `(owner_id, repo_id, path)`; no content column.
- Tests: none for DDL (T14). Checks: `cd server && pnpm typecheck`; read the SQL. Risks: on Windows `db:migrate` exits 0 without applying (server INSIGHTS 2026-10-15). Commit: C5

### T6a — ContextStore interface + container override (no schema import)
- AC: AC-CTX-14, 15, 18, 55 · server · implementer
- Files: A `server/src/modules/context/types.ts` (new) · A `server/test/helpers/context-store.ts` (new, in-memory) · M `server/src/platform/container.ts` · Depends on: T3
- Steps: `ContextStore` (scoped repo/agent/skill lookups, `getRoots`/`saveRoots`, list/insert/delete/count attachments, `loadForRun`), `ProjectContextSource`; `ContainerOverrides.contextStore?`, getter `overrides.contextStore ?? null`.
- Tests: via T7–T9. Checks: [S] · Commit: C6

### T6b — Drizzle ContextRepository + getter fallback
- AC: AC-CTX-03, 14, 15, 55, 58, 69 · server · implementer · Skills: drizzle-orm-patterns
- Files: A `server/src/modules/context/repository.ts` (new) · M `server/src/platform/container.ts` · Depends on: T5 (approval), T6a
- Steps: every query scoped by `workspaceId`; insert `onConflictDoNothing`, `order = max+1`; roots advisory lock + `planRootsUpsert`; getter fallback `new ContextRepository(db)`.
- Tests: real behaviour in T14. Checks: [S] · Commit: C10

### T7 — ContextService + routes
- AC: AC-CTX-02, 03, 04, 08, 09, 10, 11, 13, 14, 15, 17, 18, 30, 31, 39, 42, 43, 49, 50, 51, 55, 57, 58, 60, 61, 69, 76 · server · implementer · Skills: fastify-best-practices, security
- Files: A `server/src/modules/context/{service,routes}.ts` (new) · M `server/src/modules/index.ts` · A `server/test/context-routes.test.ts` (new) · Depends on: T4, T6a (not T5)
- Steps: TA3 routes; no store → 503 `CONTEXT_UNAVAILABLE` until T6b (TA11); 409 `REPO_NOT_CLONED` for list/preview; preview/attach accept only discovered docs (404/422), no content read, `readDoc` injected; status per TA5; no write/edit/reindex route.
- Tests (`buildApp({overrides:{auth, contextStore}})`): roots — "AC-CTX-03 saved roots used by next list", "AC-CTX-04 bad root 422 keeps previous", "AC-CTX-49 11 roots 422 nothing stored", "AC-CTX-02 defaults via API", "AC-CTX-13 list returns effective roots"; list/preview — "AC-CTX-08 no content in list", "AC-CTX-09 q filters", "AC-CTX-31 search on redacted text", "AC-CTX-50 q>200 422", "AC-CTX-10 preview", "AC-CTX-11 undiscovered 404 no read", "AC-CTX-39 409 not cloned", "AC-CTX-42 missing root 200", "AC-CTX-51 no write/reindex route", "AC-CTX-76 malformed 422 no read"; attachments — "AC-CTX-14 attach agent", "AC-CTX-55 attach skill", "AC-CTX-15 detach one row", "AC-CTX-57 stored normalized", "AC-CTX-58 re-attach idempotent", "AC-CTX-17 undiscovered 422", "AC-CTX-18 11th 422", "AC-CTX-61 attach reads no content", "AC-CTX-69 store write shape ids+path+order", "AC-CTX-43/60 status outside_roots/missing", "AC-CTX-30 foreign workspace 404 (unit)".
- Checks: [S] · Risks: 422 details shape (server INSIGHTS 2026-10-15); route collisions under `/agents/:id`, `/skills/:id`. Commit: C7

### T8 — Run-time builder + trace redaction
- AC: AC-CTX-16, 21, 23, 24, 25, 28, 29, 34, 35, 36, 38, 40, 41, 54, 56, 59, 60, 63, 64, 65, 66, 72, 73, 74 · server · implementer · Skills: security
- Files: A `server/src/modules/context/for-run.ts` (new) · A `server/test/context-for-run.test.ts` (new) · Depends on: T4, T6a
- Steps: `buildProjectContext` — agent rows, then each skill's rows in `planSkills` order; L7 first 10 per owner, rest `attachment limit`; repeats `duplicate`; path checks → `outside roots` → read; entry `path: p\n\n`+text; L5 cut whole trailing lines + marker; L6 running sum, first non-fitting and all later `budget exhausted`; no clone → all `repo not cloned`. `redactAssemblyForTrace` — `wrapUntrusted` placeholders, replace first exact occurrence, residual check, else fail closed. `contextLogLine`.
- Tests: "AC-CTX-21 order", "AC-CTX-16 skill docs after agent", "AC-CTX-56 duplicate", "AC-CTX-59 attachment limit", "AC-CTX-25 path line", "AC-CTX-24 4000 cut+marker", "AC-CTX-41 budget, no skip-and-continue", "AC-CTX-66/74 caps", "AC-CTX-28 absolute/traversal no read", "AC-CTX-29 symlink", "AC-CTX-38 missing", "AC-CTX-40 binary", "AC-CTX-54 not cloned", "AC-CTX-60 outside roots", "AC-CTX-63 worktree version", "AC-CTX-64 PR-only missing", "AC-CTX-34 blocks no content", "AC-CTX-65 summary+limits", "AC-CTX-35 specs_tokens full text", "AC-CTX-36 log line", "AC-CTX-72 placeholder format", "AC-CTX-73 section not found -> fail closed", "AC-CTX-73 residual doc text -> fail closed", "AC-CTX-23 none read -> no specs".
- Checks: [S] · Commit: C8

### T9 — Executor wiring
- AC: AC-CTX-16, 20, 21, 22, 23, 33, 35, 36, 38, 54, 62, 63, 64, 70, 71, 72, 73, 75 · server · implementer · Skills: security
- Files: M `server/src/modules/reviews/{run-executor,service}.ts` · A `server/test/run-executor-context.test.ts` (new) · Depends on: T8, T6a (compiles without T6b)
- Steps: optional `context` arg; try/catch around `loadForRun` (TA6); log line before `reviewPullRequest`; trace overrides; warning when not isolated (TA7). Harness: `fakeRepo` pattern (`server/test/run-executor-intent.test.ts:46-76`), temp clone, `repoRow({clonePath})`.
- Tests: "AC-CTX-70 every MockLLMProvider.calls[*].messages has marker; finalizeDoneRun trace has none (single-pass + map-reduce)", "AC-CTX-62 read once; identical Project context in every call (map-reduce)", "AC-CTX-71 other parts byte-identical (TA1)", "AC-CTX-72 persisted placeholders", "AC-CTX-22 same call count", "AC-CTX-23 baseline equal", "AC-CTX-20 changed file -> new content", "AC-CTX-33 specs_read order", "AC-CTX-35 specs_tokens", "AC-CTX-36 line before first LLM call", "AC-CTX-75 failure trace no doc text", "AC-CTX-38/63/64 run completes", "AC-CTX-54 no clone -> skipped", "AC-CTX-54 store throws -> run completes", "AC-CTX-16 skill docs injected", "AC-CTX-73 warning logged".
- Checks: [S] then [R] · Risks: placement vs the cancel checkpoint; realpath of temp dirs on Windows. Commit: C9

### T10 — Client hooks
- AC: AC-CTX-12, 53 · client · implementer · Skills: next-best-practices
- Files: A `client/src/lib/hooks/context.ts` (new) · M `client/src/lib/hooks/{core,index}.ts` · M `client/src/lib/types.ts` · Depends on: T1
- Steps: keys `["context", repoId, q]` etc.; mutations invalidate affected keys; remove `useReindexContext` and old `useContextFiles`.
- Tests: via T11/T12. Checks: [C] · Commit: C11

### T11 — Context page
- AC: AC-CTX-12, 13, 52, 53 · client · implementer
- Files: A `client/src/app/repos/[repoId]/context/page.tsx` (new) · A `…/context/_components/{ContextView,RootsEditor,DocPreview}/*` (new; incl. `ContextView.test.tsx`) · M `client/messages/en/context.json` (empty state with `{roots}`; remove `editor.*`) · M `client/src/vendor/ui/nav.ts` (+ `nav.test.ts`) (TA8) · Depends on: T10
- Tests: "AC-CTX-12 roots, search, list, preview render; nav has Project Context", "AC-CTX-52 preview has no editable control or save", "AC-CTX-53 Re-index sends only the GET list", "AC-CTX-13 empty state names roots".
- Checks: [C] · Commit: C11

### T12 — Attachment UI (agent on Context page, skill tab)
- AC: AC-CTX-14, 43, 55 · client · implementer
- Files: A `…/context/_components/AgentAttachments/{AgentAttachments.tsx,index.ts,styles.ts,AgentAttachments.test.tsx}` (new) · A `client/src/components/context-doc-status/*` (new) · A `client/src/app/skills/[id]/_components/SkillDetailView/_components/ContextTab/{ContextTab.tsx,index.ts,ContextTab.test.tsx}` (new) · M `…/SkillDetailView/{constants.ts,SkillDetailView.tsx}` · M `client/messages/en/{skills,context}.json` · Depends on: T10, T11
- Tests: `AgentAttachments.test.tsx` "AC-CTX-14 attach posts and lists", "AC-CTX-43 missing/outside_roots badges"; `ContextTab.test.tsx` "AC-CTX-55 skill attach for repo".
- Checks: [C] · Commit: C12

### T13 — Trace drawer spec rows
- AC: AC-CTX-37 · client · implementer
- Files: A `…/RunTraceDrawer/_components/SpecBlocks/{SpecBlocks.tsx,index.ts,SpecBlocks.test.tsx}` (new) · M `…/TraceBody/TraceBody.tsx` · M `client/messages/en/runs.json` · Depends on: T1
- Tests: `SpecBlocks.test.tsx` "AC-CTX-37 rows path/status/reason/tokens/truncated + summary; specs block shows placeholders".
- Checks: [C] · Commit: C13

### T14 — Integration tests — APPROVAL REQUIRED (Docker)
- AC: AC-CTX-03, 19, 30, 45 · server · test-writer
- Files: A `server/test/context.it.test.ts` (new) · Depends on: T5, T6b, T7–T9
- Steps: `buildApp({db, overrides:{github: MockGitHubClient, llm: MockLLMProvider}})` (server INSIGHTS 2026-10-17); `waitForPrRuns`.
- Tests: "AC-CTX-19 rows hold no marker", "AC-CTX-30 cross-workspace 404", "AC-CTX-45 marker reached provider; trace specs_read/tokens; no marker", "AC-CTX-03 one roots row after repeated saves".
- Checks: APPROVAL REQUIRED `cd server && pnpm exec vitest run .it.test` · Commit: C14

### T15a — Seed fixtures (P2, P3) — APPROVAL REQUIRED
- AC: AC-CTX-46 · server · implementer · Files: M `server/src/db/seed.ts` (`:75-93`) · Depends on: T5, T6b, T9
- Steps: only when `SEED_CONTEXT_CLONE_PATH` is set — set seeded repo `clonePath`; insert one `agent_runs` + its `run_traces` row for PR #482 with `specs_read: ['docs/spec.md']`, one `spec_blocks` entry, AC-72 placeholder `specs`/`user`, no doc text; idempotent.
- Checks: [S] · Risks: an extra seeded run may change flows 02/04 text asserts — update them in the same change. Commit: C15

### T15b — e2e.sh fixture clone (P1) — APPROVAL REQUIRED
- AC: AC-CTX-46 · Files: M `scripts/e2e.sh` (`:119-128`)
- Steps: temp clone dir with `docs/spec.md` (unique marker); export `SEED_CONTEXT_CLONE_PATH` before `pnpm db:seed`; delete on teardown. Checks: read-through (run in T15d). Commit: C15

### T15c — CI workflow fixture (only if CI must run the flow) — APPROVAL REQUIRED
- AC: AC-CTX-46 · Files: M `.github/workflows/e2e-web.yml` (`:65-71`) · Steps: same fixture step before `pnpm db:seed`. Commit: C15

### T15d — e2e flow — APPROVAL REQUIRED to run
- AC: AC-CTX-46 · e2e · test-writer · Files: A `e2e/specs/08-project-context.flow.json` (new) · Depends on: T11–T13, T15a–b
- Steps: open `/repos/<seeded>/context`; check roots, the `docs/spec.md` entry and read-only preview; attach to a seeded agent, check listed; open the seeded run's Trace drawer, check `docs/spec.md` + placeholder line, marker absent. No review, import or LLM call.
- Checks: `cd e2e && npm run typecheck`; APPROVAL REQUIRED `cd e2e && npm test` (or `npm run e2e:hermetic`). Commit: C16

### T16 — Manual paid acceptance — APPROVAL REQUIRED (paid)
- AC: AC-CTX-68 · Steps: test agent on an open PR with a real diff that breaks a unique rule marker in an attached spec; ≥ 1 finding cites the rule. Never automated. No commit.

## AC coverage

| AC-ID | Tasks | Test file | Verification |
|---|---|---|---|
| 01,05,06,07,47,48 | T4 | context-discovery.test.ts | unit |
| 02,42 | T4,T7 | context-discovery / context-routes | unit |
| 03 | T3,T7,T14 | context-helpers / context-routes / context.it | unit (+it) |
| 04,49,50,57,76 | T3,T7 | context-helpers / context-routes | unit |
| 08 | T1,T7 | contracts / context-routes | unit |
| 09,10,31 | T4,T7 | context-read / context-routes | unit |
| 11,13,15,17,18,39,51,61,69 | T7 (+T6a) | context-routes | unit |
| 14,55,58 | T5–T7,T12 | context-routes, AgentAttachments/ContextTab tests | unit+RTL |
| 12,52,53 | T10,T11 | ContextView.test.tsx | RTL |
| 16,21,23 | T8,T9 | context-for-run / run-executor-context | unit |
| 20,22,33,62,70,71,75 | T9 | run-executor-context | unit |
| 24,25,28,41,56,59,60,65 | T8 | context-for-run | unit |
| 29,38,40,64,66,74 | T4,T8 | context-read / context-for-run | unit |
| 32 | T3,T4 | context-helpers / context-discovery | unit |
| 34,35,36,72,73 | T8,T9 (34 also T1) | context-for-run / run-executor-context | unit |
| 54,63 | T8,T9 | context-for-run / run-executor-context | unit |
| 43 | T7,T12 | context-routes / AgentAttachments.test.tsx | unit+RTL |
| 37 | T13 | SpecBlocks.test.tsx | RTL |
| 26,27,44 | T2 | reviewer-core/test/project-context.test.ts | unit |
| 19,45 | T14 | context.it.test.ts | integration (approval) |
| 30 | T7,T14 | context-routes / context.it | unit + integration (approval) |
| 46 | T15a–d | 08-project-context.flow.json | e2e (approval) |
| 67 | T3 | grep in Final verification | manual code review |
| 68 | T16 | — | manual, paid (approval) |

## Commits (proposed; created only on the user's request)

| Commit | Tasks | Message |
|---|---|---|
| C1 | T1 | feat(contracts): add project context DTOs and trace spec fields |
| C2 | T2 | test(reviewer-core): pin project-context rendering and guard |
| C3 | T3 | feat(context): path normalization, roots validation and limits |
| C4 | T4 | feat(context): bounded markdown discovery and safe reads |
| C5 | T5 | feat(db): agent and skill context-doc attachment tables (APPROVAL) |
| C6 | T6a | feat(context): context store interface and container override |
| C7 | T7 | feat(context): routes for docs, roots and attachments |
| C8 | T8 | feat(context): build run-time project context and trace placeholders |
| C9 | T9 | feat(reviews): inject attached project context and redact it in traces |
| C10 | T6b | feat(context): drizzle context repository |
| C11 | T10,T11 | feat(client): project context page |
| C12 | T12 | feat(client): attach context docs to agents and skills |
| C13 | T13 | feat(client): show project context blocks in the trace drawer |
| C14 | T14 | test(context): persistence, scoping and end-to-end marker |
| C15 | T15a–c | test(e2e): seed and stack fixtures for project context (APPROVAL) |
| C16 | T15d | test(e2e): project context flow |

C6–C9 compile and pass without C5/C10.

## Order

Server: T1 → T3 → T4 → T6a → T7 → T8 → T9. T2 any time. Client: T10, T11, T13 after T1; T12 after T10, T11. After approvals: T5 → T6b → T14 → T15a–c → T15d → T16. Package checks never run in parallel.

## Final verification (sequential)

1. `cd server && pnpm typecheck`
2. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
3. `cd reviewer-core && npm run typecheck && npm test`
4. `cd client && pnpm typecheck && pnpm test`
5. AC-67: grep L1–L9 constant names — only under `server/src/modules/context/` (incl. `for-run.ts`) and `server/src/modules/reviews/run-executor.ts`; no PR Brief path.
6. APPROVAL REQUIRED: `cd server && pnpm exec vitest run .it.test`
7. APPROVAL REQUIRED: `cd e2e && npm test`
8. APPROVAL REQUIRED (paid): T16
9. Manual UI check by the user: Context page, skill tab, Trace drawer.

## For reviewers

- **architecture-reviewer:** new context → conventions/samples dependency; `contextStore` override; routes under `/agents/:id`, `/skills/:id`; optional executor arg; two tables vs one polymorphic; 503 before T6b.
- **security-reviewer:** normalize-then-reject; parent symlink check (TA9); realpath containment; redaction before search/preview/injection; first-occurrence replacement + residual check + fail closed; advisory-lock upsert; workspace scoping on every store method; seeded fixture traces hold no doc text.
- **plan-verifier:** every unit AC has a named `it`; TA1 for AC-71; AC-46 P1–P3; AC-67/68 manual.

## Unknowns

- Windows symlink tests may need `skipIf`.
- Whether flows 02/04 assert on run counts the new seeded run would change (check in T15a).

## Limitations

- Planning was read-only; no commands run. Migration SQL is produced by `pnpm db:generate` after approval.
- `server/docs/testing.md:71` (non-overridable repos) is not updated; no AC requires it.
