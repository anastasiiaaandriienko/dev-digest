# Verification — Project Context Folder (Key CTX)

- **Verifier:** plan-verifier (S7), 2026-10-18 · **Status:** 75/76 PASS; only AC-68 (T16, approval-gated) open
- **Scope:** spec `specs/project-context-folder/spec.md` (76 ACs) · tasks T1, T2, T3, T4, T6a, T7, T8, T9, T10, T11, T12, T13 · base `dc893e0..d35321e`. No uncommitted source changes.
- **Reviews (S6):** architecture-reviewer — approve (1 suggestion: client `MAX_ATTACHMENTS = 10` mirrors server L7); security-reviewer — approve (0 findings).
- **Summary:** PASS 75 / PARTIAL 0 / MISSING 1 (AC-68, T16 paid manual run not approved). Integration (T14) and e2e (T15d) runs accepted as reported evidence; AC-67 confirmed by the user after code review.
- **Plan-verifier re-run after T15d:** PASS 71 / PARTIAL 4 / MISSING 1 strictly observed (74/1/1 with reported runs).
- **Initial S7 summary:** PASS 65 / PARTIAL 7 / MISSING 4.

## Matrix

Commit key: C1=a029fcd (T1), C3=a3f5f89 (T3), C4=585c53c (T4), C6=4c7aed8 (T6a), C7=74b47fd (T7), C8=c668621 (T8), C9=c5adbd9 (T9), C2=7368919 (T2), C13=8d5ae89 (T13), C11/12=d35321e (T10–T12). Paths under `server/` unless noted; tests `server/test/<file>`, line = the `it(` line.

| AC | Task | Implementation | Test (all green) | Commit | Status | Note |
|---|---|---|---|---|---|---|
| 01 | T4 | src/modules/context/discovery.ts | "AC-CTX-01 order" context-discovery.test.ts:40 | C4 | PASS | |
| 02 | T4,T7 | context/{constants,discovery,service}.ts | discovery:62; routes:93 | C4,C7 | PASS | |
| 03 | T3,T7,T6b,T14 | context/{helpers,service,repository}.ts | helpers:66; routes:65; server/test/context.it.test.ts "AC-CTX-03 roots save/read…concurrent saves leave one workspace-level row" | C3,C7,C10,C14 | PASS | real Drizzle upsert under advisory lock |
| 04 | T3,T7 | context/helpers.ts | routes:74 | C3,C7 | PASS | |
| 05 | T4 | discovery.ts | discovery:71, :90 | C4 | PASS | |
| 06 | T4 | discovery.ts | discovery:83, :97 | C4 | PASS | symlink test skipIf-guarded on Windows |
| 07 | T4 | discovery.ts | discovery:103, :115 | C4 | PASS | |
| 08 | T1,T7 | contracts/platform.ts (both copies) | contracts.test.ts:368; routes:115 | C1,C7 | PASS | |
| 09 | T4,T7 | context/read.ts | context-read.test.ts:101; routes:124 | C4,C7 | PASS | |
| 10 | T4,T7 | read.ts, service.ts | context-read.test.ts:37; routes:146 | C4,C7 | PASS | |
| 11 | T7 | service.ts | routes:156 | C7 | PASS | |
| 12 | T10,T11 | client ContextView.tsx, client/src/vendor/ui/nav.ts | ContextView.test.tsx:72 | C11/12 | PASS | |
| 13 | T7,T11 | service.ts; ContextView.tsx | routes:98; ContextView.test.tsx:115 | C7,C11/12 | PASS | |
| 14 | T5,T6a,T6b,T7,T12,T14 | schema/project-context.ts, repository.ts, service.ts | routes:229; AgentAttachments.test.tsx:59; server/test/context.it.test.ts (migration, agent/skill CRUD, concurrent attaches) | C5,C6,C7,C10,C11/12,C14,fix | PASS | concurrent-order defect found and fixed (f5c2ce4) |
| 15 | T7 | service.ts | routes:246 | C7 | PASS | service level, in-memory store |
| 16 | T8,T9 | for-run.ts | context-for-run.test.ts:81; run-executor-context.test.ts:430 | C8,C9 | PASS | |
| 17 | T7 | service.ts | routes:274 | C7 | PASS | |
| 18 | T7 | service.ts | routes:291 | C7 | PASS | |
| 19 | T14 | repository.ts, run-executor.ts | server/test/context.it.test.ts "AC-CTX-19 attachment/settings rows and run_traces hold paths only" | C14 | PASS | |
| 20 | T9 | run-executor.ts | run-executor-context.test.ts:320 | C9 | PASS | |
| 21 | T8,T9 | for-run.ts | for-run:74 | C8,C9 | PASS | |
| 22 | T9 | run-executor.ts | run-executor-context.test.ts:289 | C9 | PASS | |
| 23 | T8,T9 | for-run.ts | for-run:326; run-executor-context.test.ts:303 | C8,C9 | PASS | |
| 24 | T8 | for-run.ts | for-run:126 | C8 | PASS | |
| 25 | T8 | for-run.ts | for-run:120 | C8 | PASS | |
| 26 | T2 | reviewer-core/src/prompt.ts (unchanged) | reviewer-core/test/project-context.test.ts:15 | C2 | PASS | |
| 27 | T2 | same | project-context.test.ts:40 | C2 | PASS | |
| 28 | T8 | for-run.ts | for-run:165 | C8 | PASS | |
| 29 | T4,T8 | read.ts, for-run.ts | context-read.test.ts:71, :79, :86; for-run:180 | C4,C8 | PASS | |
| 30 | T7,T14 | service.ts, repository.ts | routes:204, :338; server/test/context.it.test.ts "AC-CTX-30 another workspace … 404" | C7,C14 | PASS | |
| 31 | T4,T7 | read.ts | context-read.test.ts:91; routes:131 | C4,C7 | PASS | |
| 32 | T3,T4 | helpers.ts, discovery.ts | helpers:59; discovery:151 | C3,C4 | PASS | attach/injection paths share `normalizeContextPath` |
| 33 | T9 | run-executor.ts | run-executor-context.test.ts:332 | C9 | PASS | |
| 34 | T1,T8 | contracts/trace.ts; for-run.ts | contracts.test.ts:335; for-run:239 | C1,C8 | PASS | |
| 35 | T1,T8,T9 | for-run.ts | for-run:317; run-executor-context.test.ts:339 | C8,C9 | PASS | |
| 36 | T8,T9 | for-run.ts (`contextLogLine`) | for-run:277; run-executor-context.test.ts:347 | C8,C9 | PASS | |
| 37 | T13 | SpecBlocks.tsx, TraceBody.tsx | SpecBlocks.test.tsx:22 | C13 | PASS | |
| 38 | T4,T8,T9 | read.ts, for-run.ts | context-read.test.ts:112; for-run:188; run-executor-context.test.ts:374 | C4,C8,C9 | PASS | |
| 39 | T7 | service.ts | routes:166 | C7 | PASS | |
| 40 | T4,T8 | read.ts, for-run.ts | context-read.test.ts:64; for-run:196 | C4,C8 | PASS | |
| 41 | T8 | for-run.ts | for-run:139 | C8 | PASS | |
| 42 | T4,T7 | discovery.ts | discovery:143; routes:106 | C4,C7 | PASS | |
| 43 | T7,T12 | service.ts; ContextDocStatus | routes:324; AgentAttachments.test.tsx:85 | C7,C11/12 | PASS | |
| 44 | T2 | reviewer-core prompt (unchanged) | project-context.test.ts:63 | C2 | PASS | |
| 45 | T14 | run-executor.ts, for-run.ts, repository.ts | server/test/context.it.test.ts "AC-CTX-45 marker reaches the provider inside spec-0; persisted trace has placeholders only" | C14 | PASS | MockLLMProvider only |
| 46 | T15a–d | seed.ts (env-gated fixtures), scripts/e2e.sh, e2e-web.yml, e2e/specs/08-project-context.flow.json | `./scripts/e2e.sh` flow 08: 33/33 steps passed | 207569b, 5c0d2a9, 2a6de14 | PASS | hermetic stack, credentials blanked; flows 02/04/05 fail on a pre-existing PR-list click issue (not CTX) |
| 47 | T4 | discovery.ts | discovery:123 | C4 | PASS | |
| 48 | T4 | discovery.ts | discovery:133 | C4 | PASS | |
| 49 | T3,T7 | helpers.ts, service.ts | helpers:41; routes:85 | C3,C7 | PASS | |
| 50 | T3,T7 | helpers.ts, routes.ts | helpers:53; routes:139 | C3,C7 | PASS | |
| 51 | T7 | routes.ts | routes:187 | C7 | PASS | |
| 52 | T11 | DocPreview.tsx | ContextView.test.tsx:90 | C11/12 | PASS | |
| 53 | T10,T11 | client/src/lib/hooks/context.ts | ContextView.test.tsx:106 | C11/12 | PASS | |
| 54 | T8,T9 | for-run.ts | for-run:201; run-executor-context.test.ts:405, :415 | C8,C9 | PASS | |
| 55 | T5,T6b,T7,T12,T14 | service.ts, repository.ts | routes:237; ContextTab.test.tsx:52; server/test/context.it.test.ts skill attachment CRUD | C7,C10,C11/12,C14 | PASS | |
| 56 | T8 | for-run.ts | for-run:99 | C8 | PASS | |
| 57 | T3,T7 | helpers.ts | helpers:13; routes:257 | C3,C7 | PASS | |
| 58 | T5,T6b,T7,T14 | unique index + onConflictDoNothing | routes:265; server/test/context.it.test.ts CRUD (re-attach 200, same id) | C5,C7,C10,C14 | PASS | |
| 59 | T8 | for-run.ts | for-run:110 | C8 | PASS | |
| 60 | T7,T8 | helpers.ts (`isUnderRoots`), for-run.ts | for-run:213; routes:324 | C7,C8 | PASS | |
| 61 | T7 | service.ts | routes:303 | C7 | PASS | |
| 62 | T9 | run-executor.ts | run-executor-context.test.ts:214 | C9 | PASS | |
| 63 | T8,T9 | for-run.ts | for-run:228; run-executor-context.test.ts:382 | C8,C9 | PASS | |
| 64 | T4,T8,T9 | read.ts, for-run.ts | context-read.test.ts:118; for-run:234; run-executor-context.test.ts:398 | C4,C8,C9 | PASS | |
| 65 | T1,T8 | for-run.ts | for-run:264 | C1,C8 | PASS | |
| 66 | T4,T8 | read.ts, for-run.ts | context-read.test.ts:46; for-run:152 | C4,C8 | PASS | |
| 67 | T3 | context/constants.ts | AC-67 grep + code review (main agent), confirmed by the user 2026-10-18 | C3 | PASS | L1–L9 only under server/src/modules/context/ (constants.ts:8-27); executor uses context via for-run.js/types.js (run-executor.ts:19-27); no PR Brief module imports them |
| 68 | T16 | — | — | — | MISSING | blocked: approval (paid, manual) |
| 69 | T5,T6a,T6b,T7,T14 | schema/project-context.ts (no content column) | routes:310; server/test/context.it.test.ts AC-CTX-19 rows check | C5,C6,C7,C10,C14 | PASS | |
| 70 | T9 | run-executor.ts, for-run.ts | run-executor-context.test.ts:188 (single-pass), :202 (map-reduce) | C9 | PASS | |
| 71 | T9 | run-executor.ts | run-executor-context.test.ts:237, :259 | C9 | PASS | |
| 72 | T8,T9 | for-run.ts (`redactAssemblyForTrace`) | for-run:297; run-executor-context.test.ts:276 | C8,C9 | PASS | |
| 73 | T8,T9 | for-run.ts, run-executor.ts | for-run:337, :347; run-executor-context.test.ts:441 | C8,C9 | PASS | |
| 74 | T4,T8 | read.ts, for-run.ts | context-read.test.ts:56; for-run:159 | C4,C8 | PASS | |
| 75 | T9 | run-executor.ts (`traceFromBuffer` unchanged) | run-executor-context.test.ts:360 | C9 | PASS | |
| 76 | T3,T7 | helpers.ts, service.ts | routes:174 | C3,C7 | PASS | |

## Traceability gaps

- T5, T6b, T14, T15a–d, T16 not implemented → ACs 19, 45, 46, 68 have no implementation/test; ACs 03, 14, 30, 55, 58, 69 depend on them for real persistence. ACs 15 and 18 PASS at service level but their production behaviour also depends on the Drizzle repository.
- Without a store, production context routes answer 503 `CONTEXT_UNAVAILABLE` (TA11) and run-time injection is inert (`container.contextStore ?? undefined`) until T6b lands; it is verified through injected in-memory stores only.
- No plan-named unit test is missing; extra tests exist (second AC-13/AC-14 tests, AC-37 old-trace case).

## Checks run (sequential)

| Command | Result | Notes |
|---|---|---|
| `cd server && pnpm typecheck` | PASS | |
| `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | PASS | 48 files, 552 passed, 3 skipped (Windows symlink) |
| `cd reviewer-core && npm run typecheck && npm test` | PASS | 4 files, 50 tests |
| `cd client && pnpm typecheck && pnpm test` | PASS | 82 files, 728 tests |
| `cd client && pnpm build` (main agent, before S6) | PASS | `/repos/[repoId]/context` built |
| AC-67 grep (L1–L9 names) | clean | only `server/src/modules/context/*`; `run-executor.ts` imports `for-run.js`/`types.js` only; no PR Brief module; client mirror `MAX_ATTACHMENTS` noted |

No integration, e2e, app start, localhost or paid calls.

## Out-of-plan changes

- `client/src/components/context-doc-attachments/*` shared panel (used by `AgentAttachments` and `ContextTab`); client `MAX_ATTACHMENTS = 10` mirrors server L7.
- Support files not named in the plan: `ContextView/{constants,helpers,styles}.ts`, `RootsEditor/*`, `SpecBlocks/{constants,styles}.ts`, `client/src/lib/types.ts`, `client/messages/en/skills.json`.
- C11 and C12 combined into d35321e.

## Protected paths

No `server/src/db/migrations/**`, `server/src/db/schema/*.ts`, lockfiles, `package.json` or `pnpm-workspace.yaml` changes in range. Both vendored contract copies changed under approval.

## Verdict: gaps to close

1. T5 migration + T6b Drizzle `ContextRepository` (removes the 503; makes ACs 03, 14, 55, 58, 69 real).
2. T14 integration run (ACs 19, 30, 45, 03).
3. T15a–d seed, `e2e.sh`, flow, e2e run (AC 46).
4. T16 paid manual run (AC 68).
5. Manual UI check by the user; human confirmation of AC 67.

## Limitations

- No integration, e2e or app run. Client RTL ACs (12, 13, 37, 43, 52, 53, 55) pass on test evidence only; pages not seen in a browser.
- Per-AC tests confirmed by title and green totals; not every assertion body read. AC-71 byte-identity and AC-29 Windows symlink coverage not independently confirmed.
- Commit column derived from commit messages and file lists, not `git log -- <file>` per AC.

## Update after T5, T6b and T14 (main agent, 2026-10-18)

Rows 03, 14, 19, 30, 45, 55, 58, 69 updated from the evidence below; the remaining rows are unchanged from the plan-verifier report.

- T5 migration `0014_optimal_jocasta.sql` (6f7a0cd), applied by the user to their DB; T6b Drizzle `ContextRepository` (8b38feb). Security review of the range: approve, 0 findings.
- T14 `server/test/context.it.test.ts` (1db708b): Testcontainers `pgvector/pgvector:pg16`, migrations applied to the container only, run with the guard `DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use`, MockLLMProvider + MockGitHubClient.
- First run: 7 passed, 1 failed — concurrent attaches got orders `[1,1,1,2,2,2,2,2]` (`insertAttachment` max+1 unserialized). Fixed in f5c2ce4 (transaction + per-owner `pg_advisory_xact_lock`).
- Re-run (verbose, main agent): `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts` → 1 file, **8 passed**, 0 skipped. Server typecheck pass; server unit 552 passed, 3 skipped.

Remaining: AC-46 (T15a–d: seed, e2e.sh, e2e-web.yml, e2e run — approval), AC-68 (T16 paid manual — approval), AC-67 (manual code review confirmation), manual UI check.

## Update after T15a–c (main agent, 2026-10-18)

- 207569b: `server/src/db/seed.ts` — additive block gated by `SEED_CONTEXT_CLONE_PATH` (unset → dev seed unchanged): sets `acme/payments-api.clonePath`, inserts one `agent_runs` + `run_traces` row for PR #482 with `specs_read: ['docs/spec.md']`, one `spec_blocks` entry and AC-72 placeholder `specs`/`user` (no doc text, no marker). `scripts/e2e.sh` creates a `mktemp` fixture clone with `docs/spec.md` (marker `RULE-CTX-7f3a`), exports the path, removes it on teardown. `.github/workflows/e2e-web.yml` gets the same fixture step because `e2e/run.ts:54-60` runs every `specs/*.flow.json` in CI.
- 5c0d2a9: `e2e/specs/08-project-context.flow.json` (33 steps, not run). Uses a `select` step (native picker) not used by other flows; marker absence is not asserted by the runner (positive checks only) and holds by construction of the seed.
- Checks: server typecheck pass; server unit 552 passed, 3 skipped; `bash -n scripts/e2e.sh` pass; flow JSON parses; workflow YAML checked by eye (no parser available). `cd e2e && npm run typecheck` NOT run — `e2e/node_modules` not installed (install needs approval); no e2e TS changed.

Remaining: AC-46 e2e run (T15d — approval), AC-68 (T16 paid manual — approval), AC-67 (manual confirmation), manual UI check.

## Update after T15d (main agent, 2026-10-18)

- Prerequisites (user-approved): `cd e2e && npm ci` (lockfile unchanged), `agent-browser` 0.39.1 + Chrome 155. Runner given the native binary via the existing `AGENT_BROWSER_BIN` knob (`spawn agent-browser ENOENT` with the npm .cmd shim on Windows).
- Credential isolation: no `~/.devdigest/secrets.json` on the machine; run with `OPENAI_API_KEY= ANTHROPIC_API_KEY= OPENROUTER_API_KEY= GITHUB_TOKEN= GITHUB_PAT=` exported empty (dotenv 16 does not override) and `DEVDIGEST_CLONE_DIR` in a temp dir. API log confirmed `GITHUB_TOKEN is not configured` → persisted PRs only.
- Run 1 failed at seed: `pnpm db:migrate` exited 0 without applying on Windows (`migrate.ts` CLI guard). Fixed with user approval in c606811 (`isCliEntry` via `pathToFileURL`, regression test `server/test/migrate-cli.test.ts`); verified on a throwaway DB (:5434): `✓ migrations applied`, 15 migrations, both context tables.
- Final run (`./scripts/e2e.sh`, isolated :5433/:3101/:3100): test DB had 15 migrations and both `agent_context_docs`, `skill_context_docs`. Flows **5/8 passed**: 01, 03, 06, 07, **08 (33/33 steps)**. Flow 08 covers the Context page, roots editor, doc list, read-only Markdown preview with marker, attach to agent (201) + listed + detach, PR #482 Trace drawer with `docs/spec.md` read, `1 of 1 read` and the placeholder line.
- Flow 08 fixes (2a6de14): wait for networkidle after Attach (Detach raced the list refetch); open PR #482 by `#482` (the truncated title link is covered by the `FINDINGS 2` chip at viewport 1262; `agent-browser` refuses covered clicks). No assertion removed or weakened.
- Flows 02, 04, 05 FAIL at `find text "Add rate limiting to public API endpoints" click` — same covered-click cause; these flows and the PR list are unchanged on this branch. Out of T15d scope; awaiting user decision.
- Teardown: e2e container removed, ports 3100/3101/5433 free, no fixture dirs left, `secrets.json` still absent.

## Re-verification after T15d (plan-verifier, 2026-10-18)

- Scope: all 76 ACs, tasks T1–T4, T5, T6a, T6b, T7–T13, T14, T15a–d, range `dc893e0..e8d8e50`; working tree clean; all evidence committed.
- Checks run by the verifier (sequential): server typecheck PASS; server unit 49 files, 555 passed, 3 skipped (Windows symlink); reviewer-core 50 passed; client 82 files, 728 passed; `cd e2e && npm run typecheck` PASS; AC-67 grep clean (L1–L9 only under `server/src/modules/context/`; `seed.ts` imports only `placeholderLine`; client mirrors `MAX_ATTACHMENTS`).
- Not re-run by the verifier (reported evidence): T14 `context.it.test.ts` 8/8; T15d flow 08 33/33.
- Status changes vs the matrix above: **19, 45, 46 → PARTIAL (reported-evidence PASS)**; 67 PARTIAL (human code-review confirmation); **68 MISSING** (T16 paid manual, not approved). All other ACs PASS. Rows 03, 14, 30, 55, 58, 69 PASS with their DB-backed part resting on the reported T14 run.
- Out-of-plan: c606811 (migrate CLI guard, user-approved, outside CTX scope); 2a6de14 (flow 08: networkidle wait, open PR by `#482`; no assertion removed); flow 08 uses `select`, detaches after attaching, and cannot assert marker absence (runner has positive checks only); client support files and the shared `context-doc-attachments` panel; C11+C12 combined (d35321e).
- Protected paths: only the new `0014_optimal_jocasta.sql`, `meta/0014_snapshot.json` and the generated `_journal.json` entry under migrations; no lockfile/`package.json`/workspace changes.
- Gaps: AC-68 (T16, approval), AC-67 (human confirmation), flows 02/04/05 fail on the pre-existing covered PR-title click (outside CTX), manual UI check.

## AC-67 closed (user confirmation, 2026-10-18)

Read-only code review: L1–L9 and `DEFAULT_ROOTS` are declared only in `server/src/modules/context/constants.ts:8-27` and referenced only by `server/src/modules/context/*` (e.g. `for-run.ts:3-12`, `read.ts:4`, `helpers.ts:2`, `service.ts:12,211-212`); `server/src/modules/reviews/run-executor.ts:19-27` imports only `for-run.js` and `types.js`; no PR Brief module exists in `server/src/modules/` and no brief code path imports context. Notes (not violations): `server/src/db/seed.ts:12` imports the `placeholderLine` formatter; `client/src/components/context-doc-attachments/constants.ts:2` mirrors `MAX_ATTACHMENTS` as a UI hint. Layering: `context/routes.ts:1-15` and `service.ts:1-16` import no `db/`; only `repository.ts:1-3` uses Drizzle. The user confirmed AC-67 → PASS.

Working DB (:5432, read-only check): 15 migrations, last `created_at` = 0014 journal `when` (1792319333871); `agent_context_docs` and `skill_context_docs` columns, unique indexes and FKs match `schema/project-context.ts`.

## Amendment A1 — Agent editor Context tab (plan-verifier, 2026-10-19)

- **Scope:** AC-CTX-77..106 · plan `specs/project-context-folder/plan-a1.md` (Approved, G2) · range `7cc8c57..fde760f`.
- **Commits:** C1 d81e847, C2 97cf6ac, C3 677d2df, C4 a9cb05e, C5 940c9a2, C6 6b7fe0b, C7 780d9b6, C8 455cf1e, C9 f909d85, C10 499a67c (AC-101 integration test, written, not run), review fix fde760f (shared `MAX_ATTACHMENTS`).
- **Reviews:** architecture-reviewer — approve (1 suggestion, applied in fde760f); security-reviewer — approve (0 findings).
- **Summary: PASS 30 / PARTIAL 0 / MISSING 0** (initially 29/1/0 before the approved AC-101 run). CT = `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/`.

| AC | Task | Test (green) | Commit | Status | Note |
|---|---|---|---|---|---|
| 77 | T3 | AgentEditor.test.tsx:74 | 677d2df | PASS | three tabs |
| 78 | T3 | AgentEditorView.test.tsx:186 | 677d2df | PASS | |
| 79 | T3 | AgentEditorView.test.tsx:196 | 677d2df | PASS | |
| 80 | T3 | AgentEditor.test.tsx:82; AgentEditorView.test.tsx:203 | 677d2df | PASS | `hidden={tab !== "config"}` |
| 81 | T3 | AgentEditorView.test.tsx:215 | 677d2df | PASS | |
| 82 | T2 | CT ContextTab.test.tsx:99; helpers.test.ts:15,24 | 97cf6ac | PASS | |
| 83 | T2 | ContextTab.test.tsx:110; helpers.test.ts:29 | 97cf6ac | PASS | |
| 84 | T2 | ContextTab.test.tsx:119 | 97cf6ac | PASS | |
| 85 | T2,T4 | ContextTab.test.tsx:125; ContextTab.sync.test.tsx:129 | 97cf6ac, a9cb05e | PASS | |
| 86 | T2,T4 | ContextTab.test.tsx:133; ContextTab.sync.test.tsx:143 | 97cf6ac, a9cb05e | PASS | |
| 87 | T2 | ContextTab.test.tsx:142 | 97cf6ac, fde760f | PASS | shared `MAX_ATTACHMENTS` |
| 88 | T2 | ContextTab.test.tsx:152 | 97cf6ac | PASS | |
| 89 | T1,T2 | ContextTab.test.tsx:161 | d81e847, 97cf6ac | PASS | DocPreview moved unchanged (R100) |
| 90 | T2 | ContextTab.test.tsx:171; helpers.test.ts:44 | 97cf6ac | PASS | |
| 91 | T2 | ContextTab.test.tsx:178 | 97cf6ac | PASS | |
| 92 | T2 | ContextTab.test.tsx:184 | 97cf6ac | PASS | |
| 93 | T2 | ContextTab.test.tsx:194 | 97cf6ac | PASS | |
| 94 | T2,T9 | ContextTab.test.tsx:201, 249 | 97cf6ac, f909d85 | PASS | reorder kept when not cloned (A-4) |
| 95 | T5,T9 | ContextTab.sync.test.tsx:199; helpers.test.ts:55 | 940c9a2, f909d85 | PASS | one PUT with all ids |
| 96 | T9 | ContextTab.test.tsx:224 | f909d85 | PASS | |
| 97 | T9 | ContextTab.sync.test.tsx:222 | f909d85 | PASS | |
| 98 | T5–T7 | server/test/context-routes.test.ts:367 | 940c9a2, 6b7fe0b, 780d9b6 | PASS | agents + skills |
| 99 | T6,T7 | context-routes.test.ts:382 | 6b7fe0b, 780d9b6 | PASS | 422, nothing written |
| 100 | T7 | context-routes.test.ts:404 | 780d9b6 | PASS | 404 before any write |
| 101 | T6,T10 | server/test/context.it.test.ts:269 ✓ (run 2026-10-19) | 6b7fe0b, 499a67c | PASS | integration run approved; 9/9 in context.it.test.ts |
| 102 | T4 | ContextTab.sync.test.tsx:158 | a9cb05e | PASS | |
| 103 | T8 | server/test/run-executor-context.test.ts:346 | 455cf1e | PASS | |
| 104 | T1,T4 | ContextTab.sync.test.tsx:173 + 3 existing tests unedited in range | d81e847, a9cb05e | PASS | |
| 105 | T2 | ContextTab.test.tsx:216; helpers.test.ts:50 | 97cf6ac | PASS | kB, no tokens |
| 106 | T5,T7,T9 | manual diff review | 940c9a2, 780d9b6, f909d85 | PASS | one new route, one new contract, one new hook; `ContextListItem`/`ContextAttachment` unchanged |

- **Checks run (sequential):** client typecheck + 88 files / 777 tests PASS; server typecheck PASS; server unit 54 files, 599 passed, 3 skipped. No integration/e2e, no DB, no paid calls. Unit suites show no regression for AC-CTX-01..76.
- **Protected paths:** no migrations, schema, lockfiles, `package.json`; both contract copies changed identically under the Q19 approval.
- **Gaps:** run AC-CTX-101 (`cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts`, approval); manual UI check `/agents/<id>?tab=context` (attach, reorder, preview).
- **AC-101 run (approved, 2026-10-19):** `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/context.it.test.ts` — Testcontainers `pgvector/pgvector:pg16` (Docker 29.8.2) → **9 passed / 0 failed / 0 skipped**, incl. "AC-CTX-101 concurrent reorder/attach and reorder/reorder keep distinct gap-free orders under the advisory lock"; the earlier CTX integration tests (AC-03, 14 ×4, 19, 30, 45) still pass. Remaining gap: manual UI check `/agents/<id>?tab=context`.
