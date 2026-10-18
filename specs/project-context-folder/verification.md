# Verification — Project Context Folder (Key CTX)

- **Verifier:** plan-verifier (S7), 2026-10-18 · **Status:** gaps to close (T15a–d, T16 approval-gated; AC-67 manual)
- **Scope:** spec `specs/project-context-folder/spec.md` (76 ACs) · tasks T1, T2, T3, T4, T6a, T7, T8, T9, T10, T11, T12, T13 · base `dc893e0..d35321e`. No uncommitted source changes.
- **Reviews (S6):** architecture-reviewer — approve (1 suggestion: client `MAX_ATTACHMENTS = 10` mirrors server L7); security-reviewer — approve (0 findings).
- **Summary:** PASS 73 / PARTIAL 1 / MISSING 2 (updated after T5, T6b and T14; see the T14 section).
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
| 46 | T15a–d | — | — | — | MISSING | blocked: approval (seed, e2e.sh, flow, e2e run) |
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
| 67 | T3 | context/constants.ts | AC-67 grep (clean) | C3 | PARTIAL | manual code-review AC; human confirmation pending |
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
