# Verification — PR Why + Risk Brief (Key BRIEF)

- **Verifier:** plan-verifier (S7), 2026-10-18 · **Status:** gaps to close (integration/e2e runs and paid T12 not approved yet)
- **Scope:** spec `specs/pr-why-risk-brief/spec.md` (Approved, amended D18/D19; 50 AC-IDs, 49 active, AC-BRIEF-40 Withdrawn) · plan `specs/pr-why-risk-brief/plan.md` (Approved) · tasks T1–T11 (T6, T11 written, not run; T12 not done) · range `eaf279d..9feb6b4`.
- **Reviews (S6):** architecture-reviewer — approve (1 suggestion: local `Tokenizer` port, applied in 9feb6b4); security-reviewer — approve (0 findings).
- **Summary (after T6/T11 runs):** PASS 47 / PARTIAL 1 / MISSING 1 (49 active). Initial S7: PASS 33 / PARTIAL 15 / MISSING 1.

Commit key: C1 0831bf9 · C2 8dc0fdb · C3 adf75ca · C4 3e48073 · C5 9cfd128 · C6 eba743f · C7 4765ea4 · C8 139afd0 · C9 64d750c · C10 20223c7 · C11 88965ea · fix 9feb6b4. Server tests in `server/test/`; client tests co-located.

## Matrix

| AC | Task | Implementation | Test | Commit | Status | Note |
|---|---|---|---|---|---|---|
| 01 | T4,T6 | brief/service.ts:226 single `completeStructured` | brief-service "AC-BRIEF-01 one completeStructured call" ✓; brief.it.test.ts:263 ✓ (16/16) | C4,C6 | PASS | unit + integration green |
| 02 | T4 | service.ts:118,138 | "AC-BRIEF-02 resolves risk_brief model" ✓ | C4 | PASS | |
| 03 | T2 | prompt.ts input type has no `patch`; repository lists files without patch | "AC-BRIEF-03 prompt has no patch text" ✓ | C2 | PASS | |
| 04 | T2 | prompt.ts `fits` vs `BRIEF_ASSEMBLY_MAX_TOKENS` (4500) | "AC-BRIEF-04 assembled messages ≤ 4500 tokens" ✓ | C2, 9feb6b4 | PASS | |
| 05 | T2 | prompt.ts truncation order | "AC-BRIEF-05 truncates in D5 order and flags truncated" ✓ | C2 | PASS | |
| 06 | T2 | prompt.ts sections via `wrapUntrusted` + `sanitize` | "AC-BRIEF-06 wraps every PR-derived string" ✓ | C2 | PASS | |
| 07 | T4,T6 | service.ts reads `getIntentRow` only; no IntentService | brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 08 | T4 | service.ts `safeParse` before save | "AC-BRIEF-08 invalid output persists nothing" ✓ | C4 | PASS | |
| 09 | T3 | helpers.ts:41-48 | "AC-BRIEF-09 …" ✓ | C3 | PASS | |
| 10 | T3 | helpers.ts:51-59 | "AC-BRIEF-10 …" ✓ | C3 | PASS | |
| 11 | T3 | helpers.ts:41-48 | "AC-BRIEF-11 …" ✓ | C3 | PASS | |
| 12 | T3 | helpers.ts:46 | "AC-BRIEF-12 keeps first 8 focus" ✓ | C3 | PASS | |
| 13 | T4,T6 | service.ts meta; repository `saveBrief` two-part guard | unit .toSQL() ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) (incl. older-flight and superseded-head guard) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 14 | T5,T6 | routes.ts:19 | brief.it.test.ts ✓ (16/16, 2026-10-18) | C5,C6 | PASS | integration run approved 2026-10-18 |
| 15 | T5,T6 | service.ts:93 | brief.it.test.ts ✓ (16/16, 2026-10-18) | C5,C6 | PASS | integration run approved 2026-10-18 |
| 16 | T3,T6 | helpers.ts:74 | "AC-BRIEF-16 stale reason per head/model/prompt" ✓; it:399 ✓ (16/16) | C3,C6 | PASS | unit + integration green |
| 17 | T5,T6 | service.ts cache path | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 18 | T5,T6 | service.ts force path | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 19 | T4,T6 | service.ts single-flight | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 20 | T4,T6 | service.ts 422, no fallback | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 21 | T4 | service.ts error path | "AC-BRIEF-21 LLM error keeps previous brief" ✓ | C4 | PASS | |
| 22 | T5,T6 | workspace-scoped `getPull` | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 23 | T5,T6 | routes.ts `IdParams` | brief.it.test.ts ✓ (16/16, 2026-10-18) | C5,C6 | PASS | integration run approved 2026-10-18 |
| 24 | T4 | service.ts:240 cost fallback | "AC-BRIEF-24 …" ✓ | C4 | PASS | |
| 25 | T2 | prompt.ts:140 | "AC-BRIEF-25 …" ✓ | C2 | PASS | |
| 26 | T2 | prompt.ts:108-113 | "AC-BRIEF-26 …" ✓ | C2 | PASS | |
| 27 | T1 | identical hunks in both `brief.ts` and `review-api.ts` copies | diff check | C1 | PASS | manual AC |
| 28 | T2,T10 | no `context/constants` import in `modules/brief/` or `seed-brief.ts` | brief-boundary "AC-BRIEF-28 …" ✓ + grep | C2,C10 | PASS | |
| 29 | T5,T6 | routes.ts:27 rate limit 10/min | brief.it.test.ts ✓ (16/16, 2026-10-18) (production app, 11th POST 429) | C5,C6 | PASS | integration run approved 2026-10-18 |
| 30 | T8 | OverviewTab.tsx | OverviewTab.test "AC-BRIEF-30 …" ✓ | C8 | PASS | |
| 31 | T8 | BriefCard.tsx | "AC-BRIEF-31 …" ✓ | C8 | PASS | |
| 32 | T8 | BriefCard.tsx | "AC-BRIEF-32 …" + model_error test ✓ | C8 | PASS | |
| 33 | T8 | BriefCard.tsx | "AC-BRIEF-33 …" ✓ | C8 | PASS | |
| 34 | T8 | BriefCard.tsx | "AC-BRIEF-34 …" ✓ | C8 | PASS | |
| 35 | T8 | BriefCard helpers `focusHref` | "AC-BRIEF-35 …" ✓ | C8 | PASS | |
| 36 | T9 | page.tsx, DiffTab, DiffViewer, FileCard | DiffTab "AC-BRIEF-36 …" (+ smart group); FileCard "AC-BRIEF-36 …" ✓ | C9 | PASS | |
| 37 | T9 | DiffTab, diff-viewer `hasNewSideLine` | DiffTab "AC-BRIEF-37 …" ×2 ✓ | C9 | PASS | |
| 38 | T8 | brief.json; BriefCard.tsx | "AC-BRIEF-38 strings come from brief.json" ✓ | C8 | PARTIAL | manual half (no hard-coded strings, layout) pending |
| 39 | T7 | hooks/brief.ts | "AC-BRIEF-39 …" ×2 ✓ | C7 | PASS | |
| 40 | — | — | — | — | Withdrawn | not counted |
| 41 | T10,T11 | seed-brief.ts; 09-pr-brief.flow.json | e2e 09-pr-brief ✓ (14/14 steps): URL tab=diff, file=, line=12 + focus-missing-line notice | C10,C11,f269cdf | PASS | e2e run approved 2026-10-18 |
| 42 | T12 | meta records `attempts` and cumulative tokens | — | — | MISSING | paid run not approved |
| 43 | T4,T6,T11 | MockLLMProvider / test-local fakes; e2e never clicks Generate | code review | C4,C6,C11 | PASS | manual AC (grep + partial read) |
| 44 | T10,T11 | seed-brief.ts, seed.ts | brief-seed unit ✓; e2e 09-pr-brief ✓ (summary, risk, REVIEW FOCUS (2)) | C10,C11,f269cdf | PASS | e2e run approved 2026-10-18 |
| 45 | T4 | service.ts:175 504, flight continues | "AC-BRIEF-45 …" ✓ | C4 | PASS | |
| 46 | T4,T6 | service.ts:136,204 409 before LLM | unit ✓; brief.it.test.ts ✓ (16/16, 2026-10-18) | C4,C6 | PASS | integration run approved 2026-10-18 |
| 47 | T3 | helpers.ts:51 | "AC-BRIEF-47 …" ✓ | C3 | PASS | |
| 48 | T8 | BriefCard.tsx | "AC-BRIEF-48 …" ✓ | C8 | PASS | |
| 49 | T2 | prompt.ts:158 `clipToTokens` 1500 | "AC-BRIEF-49 …" ✓ | C2 | PASS | |
| 50 | T4 | service.ts:233 `maxTokens: 2000`, `maxRetries: 1` | "AC-BRIEF-50 …" ✓ | C4 | PASS | |

## Checks run (sequential)

| Command | Result |
|---|---|
| `cd server && pnpm typecheck` | PASS (`src/**` only) |
| `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | PASS — 54 files, 592 passed, 3 skipped (not brief) |
| `cd client && pnpm typecheck && pnpm test` | PASS — 85 files, 744 tests |
| `cd client && pnpm build` (implementer, T9) | PASS |
| `cd e2e && npm run typecheck` | PASS |
| contract hunk diff (AC-27), `context/constants` grep (AC-28) | identical / no imports |
| `brief.it.test.ts`, e2e flow 09, paid T12 | NOT RUN (approval) |

## Out-of-plan changes

`server/test/brief-seed.test.ts`; `DiffTab/styles.ts` notice style; `BriefCard/constants.ts`; `diff-viewer/helpers.ts` `hasNewSideLine` + barrel re-export; `SEED_BRIEF_SUMMARY` export; local `Tokenizer` port (9feb6b4). Protected paths: no migrations/schema/lockfiles/`package.json`; `seed.ts` + `seed-brief.ts` under the T10 approval; both contract copies under T1.

## Gaps to close

1. Run `server/test/brief.it.test.ts` (Docker, approval) → 07, 13–15, 17–20, 22, 23, 29, 46 (+ integration halves of 01, 16).
2. Run e2e flow `09-pr-brief` via `./scripts/e2e.sh` (approval) → 41, 44.
3. Paid manual T12 → 42 (repeat until a sample with `meta.attempts = 1`).
4. Manual i18n/layout check → 38.

## Update after approved T6 and T11 runs (main agent, 2026-10-18)

- **T6 integration** — `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/brief.it.test.ts`: Testcontainers `pgvector/pgvector:pg16`, mocked LLM (test-local fake, openai slot) and a GitHub spy → **16 passed / 0 failed / 0 skipped** (Docker 29.8.2). Covers AC-01, 07, 13 (+ older-flight and superseded-head guard), 14, 15, 16, 17, 18, 19, 20, 22, 23, 29, 46.
- **T11 e2e** — `./scripts/e2e.sh` on the isolated stack (Postgres :5433, API :3101, web :3100) with `OPENAI_API_KEY= ANTHROPIC_API_KEY= OPENROUTER_API_KEY= GITHUB_TOKEN= GITHUB_PAT=` exported empty, `DEVDIGEST_CLONE_DIR` in a temp dir, native `AGENT_BROWSER_BIN`. Test DB: 15 migrations, 1 `pr_brief` row with `meta.head_sha` = PR head `a1b2c3d4e5f6`. API log showed `GITHUB_TOKEN is not configured` (no GitHub calls); no LLM calls.
  - Run 1: 8/9 flows; flow 09 failed at `wait --text "Review focus (2)"` — the heading is uppercased by CSS (`text-transform`), the visible text is "REVIEW FOCUS (2)" (failure screenshot confirmed the brief rendered correctly).
  - Fix f269cdf: the flow waits for the rendered text "REVIEW FOCUS (2)" (same exact-match assertion).
  - Run 2: **9/9 flows passed, 0 failed, 0 skipped** (01 app-boot, 02 PR detail, 03 agents, 04 findings, 05 diff, 06 onboarding, 07 settings, 08 project context, 09 PR brief 14/14 steps). Teardown: e2e container removed, ports 3100/3101/5433 free, no fixture dirs; dev DB :5432 not touched.
- **Status after runs:** PASS 47 / PARTIAL 1 (AC-38 manual UI/i18n check) / MISSING 1 (AC-42, paid T12 not approved). Confirmed by the plan-verifier re-run below.

## Re-verification after T6/T11 runs (plan-verifier, 2026-10-18)

- Verifier re-ran (sequential): server typecheck PASS; server unit 54 files, 592 passed, 3 skipped (not brief); client 85 files, 744 tests PASS; e2e typecheck PASS; greps (no `context/constants` import in brief code; no `fetch(`/`https://` in brief tests; no tokens/cost rendering in BriefCard; no protected-path changes).
- Reported evidence (not re-run by the verifier, titles/steps confirmed present): `brief.it.test.ts` 16 `it` blocks = 16 passed; e2e 9/9 flows, flow 09 14/14.
- f269cdf judged as preserving assertion strength (exact-match wait on the CSS-uppercased heading `styles.ts:36`, i18n key `brief.json:31`).
- **Summary: PASS 47 / PARTIAL 1 (AC-38 manual UI/i18n check) / MISSING 1 (AC-42 paid T12 not approved).** 14 of the 47 PASS rest partly or wholly on the reported runs (07, 13, 14, 15, 22, 23, 29 integration; 41, 44 e2e).
- Caveat AC-41: e2e proves the deep link by URL params + the "not in the loaded diff" notice (seeded files have no patch); card expansion is proven by the DiffTab/FileCard RTL tests.
