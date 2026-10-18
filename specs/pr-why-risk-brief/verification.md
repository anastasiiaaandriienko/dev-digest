# Verification — PR Why + Risk Brief (Key BRIEF)

- **Verifier:** plan-verifier (S7), 2026-10-18 · **Status:** gaps to close (integration/e2e runs and paid T12 not approved yet)
- **Scope:** spec `specs/pr-why-risk-brief/spec.md` (Approved, amended D18/D19; 50 AC-IDs, 49 active, AC-BRIEF-40 Withdrawn) · plan `specs/pr-why-risk-brief/plan.md` (Approved) · tasks T1–T11 (T6, T11 written, not run; T12 not done) · range `eaf279d..9feb6b4`.
- **Reviews (S6):** architecture-reviewer — approve (1 suggestion: local `Tokenizer` port, applied in 9feb6b4); security-reviewer — approve (0 findings).
- **Summary:** **PASS 33 / PARTIAL 15 / MISSING 1** (49 active). The verifier's report heading said 31/17; its own recount (authoritative) is 33/15/1.

Commit key: C1 0831bf9 · C2 8dc0fdb · C3 adf75ca · C4 3e48073 · C5 9cfd128 · C6 eba743f · C7 4765ea4 · C8 139afd0 · C9 64d750c · C10 20223c7 · C11 88965ea · fix 9feb6b4. Server tests in `server/test/`; client tests co-located.

## Matrix

| AC | Task | Implementation | Test | Commit | Status | Note |
|---|---|---|---|---|---|---|
| 01 | T4,T6 | brief/service.ts:226 single `completeStructured` | brief-service "AC-BRIEF-01 one completeStructured call" ✓; brief.it.test.ts:263 not run | C4,C6 | PASS | integration half not run (approval) |
| 02 | T4 | service.ts:118,138 | "AC-BRIEF-02 resolves risk_brief model" ✓ | C4 | PASS | |
| 03 | T2 | prompt.ts input type has no `patch`; repository lists files without patch | "AC-BRIEF-03 prompt has no patch text" ✓ | C2 | PASS | |
| 04 | T2 | prompt.ts `fits` vs `BRIEF_ASSEMBLY_MAX_TOKENS` (4500) | "AC-BRIEF-04 assembled messages ≤ 4500 tokens" ✓ | C2, 9feb6b4 | PASS | |
| 05 | T2 | prompt.ts truncation order | "AC-BRIEF-05 truncates in D5 order and flags truncated" ✓ | C2 | PASS | |
| 06 | T2 | prompt.ts sections via `wrapUntrusted` + `sanitize` | "AC-BRIEF-06 wraps every PR-derived string" ✓ | C2 | PASS | |
| 07 | T4,T6 | service.ts reads `getIntentRow` only; no IntentService | brief.it.test.ts:276 not run | C4,C6 | PARTIAL | not run: approval |
| 08 | T4 | service.ts `safeParse` before save | "AC-BRIEF-08 invalid output persists nothing" ✓ | C4 | PASS | |
| 09 | T3 | helpers.ts:41-48 | "AC-BRIEF-09 …" ✓ | C3 | PASS | |
| 10 | T3 | helpers.ts:51-59 | "AC-BRIEF-10 …" ✓ | C3 | PASS | |
| 11 | T3 | helpers.ts:41-48 | "AC-BRIEF-11 …" ✓ | C3 | PASS | |
| 12 | T3 | helpers.ts:46 | "AC-BRIEF-12 keeps first 8 focus" ✓ | C3 | PASS | |
| 13 | T4,T6 | service.ts meta; repository `saveBrief` two-part guard | unit SQL `.toSQL()` tests "AC-BRIEF-13 …" ✓; brief.it.test.ts:296,325,344 not run | C4,C6 | PARTIAL | DB behaviour not run: approval |
| 14 | T5,T6 | routes.ts:19 | brief.it.test.ts:373 not run | C5,C6 | PARTIAL | not run: approval |
| 15 | T5,T6 | service.ts:93 | brief.it.test.ts:388 not run | C5,C6 | PARTIAL | not run: approval |
| 16 | T3,T6 | helpers.ts:74 | "AC-BRIEF-16 stale reason per head/model/prompt" ✓; it:399 not run | C3,C6 | PASS | unit half green |
| 17 | T5,T6 | service.ts cache path | unit "AC-BRIEF-17 …" ✓ (extra); it:426 not run | C4,C6 | PARTIAL | listed verification is integration |
| 18 | T5,T6 | service.ts force path | unit ✓ (extra); it:444 not run | C4,C6 | PARTIAL | as 17 |
| 19 | T4,T6 | service.ts single-flight | unit "AC-BRIEF-19 …" ✓ (extra); it:458 not run | C4,C6 | PARTIAL | as 17 |
| 20 | T4,T6 | service.ts 422, no fallback | unit "AC-BRIEF-20 …" ✓ (extra); it:474 not run | C4,C6 | PARTIAL | as 17 |
| 21 | T4 | service.ts error path | "AC-BRIEF-21 LLM error keeps previous brief" ✓ | C4 | PASS | |
| 22 | T5,T6 | workspace-scoped `getPull` | unit "AC-BRIEF-22 …" ✓ (extra); it:504 not run | C4,C6 | PARTIAL | as 17 |
| 23 | T5,T6 | routes.ts `IdParams` | it:521 not run | C5,C6 | PARTIAL | not run: approval |
| 24 | T4 | service.ts:240 cost fallback | "AC-BRIEF-24 …" ✓ | C4 | PASS | |
| 25 | T2 | prompt.ts:140 | "AC-BRIEF-25 …" ✓ | C2 | PASS | |
| 26 | T2 | prompt.ts:108-113 | "AC-BRIEF-26 …" ✓ | C2 | PASS | |
| 27 | T1 | identical hunks in both `brief.ts` and `review-api.ts` copies | diff check | C1 | PASS | manual AC |
| 28 | T2,T10 | no `context/constants` import in `modules/brief/` or `seed-brief.ts` | brief-boundary "AC-BRIEF-28 …" ✓ + grep | C2,C10 | PASS | |
| 29 | T5,T6 | routes.ts:27 rate limit 10/min | it:549 not run | C5,C6 | PARTIAL | not run: approval |
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
| 41 | T10,T11 | seed-brief.ts; 09-pr-brief.flow.json | e2e typecheck ✓; flow not run | C10,C11 | PARTIAL | not run: approval; proves URL + notice (forced expansion via RTL AC-36) |
| 42 | T12 | meta records `attempts` and cumulative tokens | — | — | MISSING | paid run not approved |
| 43 | T4,T6,T11 | MockLLMProvider / test-local fakes; e2e never clicks Generate | code review | C4,C6,C11 | PASS | manual AC (grep + partial read) |
| 44 | T10,T11 | seed-brief.ts, seed.ts | brief-seed "AC-BRIEF-44 …" ✓; e2e not run | C10,C11 | PARTIAL | listed verification is e2e |
| 45 | T4 | service.ts:175 504, flight continues | "AC-BRIEF-45 …" ✓ | C4 | PASS | |
| 46 | T4,T6 | service.ts:136,204 409 before LLM | unit "AC-BRIEF-46 …" ✓ (extra); it:528 not run | C4,C6 | PARTIAL | listed verification is integration |
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
