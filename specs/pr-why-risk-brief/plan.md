# Development Plan — PR Why + Risk Brief

- **Status:** Approved (2026-10-18, G2) · Approvals granted: T1 (contracts, both copies), T10 (seed). Pending: running T6 (integration), running T11 (e2e), T12 (paid manual run). Open SPEC_GAP: AC-BRIEF-42 vs maxRetries (see "Retries vs exactly one call").
- **Spec:** `specs/pr-why-risk-brief/spec.md` (Key BRIEF, Approved 2026-10-18, f28b073; 50 AC-IDs: 49 active, AC-BRIEF-40 Withdrawn)
- **Planner:** implementation-planner (opus), MODE PLAN · **Cross-model review:** implementation-planner (sonnet), MODE REVIEW — "approve with changes" (3 major, 11 minor); all 14 findings applied, accepted by the user 2026-10-18.
- **Goal:** a PR Brief card on Overview (summary, risks, review focus, Generate/Refresh, freshness), served by a new `modules/brief` (GET/POST `/pulls/:id/brief`, one `completeStructured` call, input ≤ 8k tokens), plus a deep link into Files changed.
- **Scope (user, option A):** verdict header, PR score ring, cost/tokens line, "Prior PRs", per-file "What this does" are non-goals. UI gate passed (current-state screenshots of seeded PR #482).

## Technical assumptions (confirmed by the user 2026-10-18)

- **A1** `PrBriefState` goes in `contracts/review-api.ts`, next to `PrIntentState`. It cannot go in `brief.ts`: `review-api.ts:3` already imports `brief.ts` (cycle). The POST body reuses `IntentRunRequest` (`review-api.ts:164-167`).
- **A2** `PrBrief.intent` and `.blast` are required (`brief.ts:175-180`). The stored brief holds the stored intent, or `{intent:'',in_scope:[],out_of_scope:[]}` plus `meta.intent_available=false`, and the blast snapshot used as input. The card renders neither; IntentBlock and BlastRadiusBlock are unchanged.
- **A3** `modules/brief/` also has `prompt.ts` and `failures.ts`, next to the 5 files named in D13 (mirrors `reviews/intent/`).
- **A5** Freshness compares `meta.head_sha`, provider/model and prompt_version (no fingerprint). Missing row or failed `PrBrief` parse → `brief:null` + `unknown`. `model_error` is set when the resolved provider has no key (local secrets lookup only, `intent/service.ts:99-107`).
- **A6** Title clipped to 300 chars (as `INTENT_TITLE_MAX_CHARS`), never dropped.
- **A7** Upsert guard (extends `SAVE_INTENT_WHERE`, `server/src/modules/reviews/repository/intent.repo.ts:73`). `generated_at` alone is not sufficient: two flights can take their timestamps and read the PR head in interleaved order, so a flight that read the OLD head can carry the LATER `generated_at`. The guard therefore has two parts, evaluated in the `ON CONFLICT … DO UPDATE … WHERE` and as a pre-check for the first insert:
  1. **Head check (always):** the incoming `meta.head_sha` must equal the PR's current `pull_requests.head_sha` at write time (correlated subquery on `pr_id`). A flight whose head is no longer current is never written, whatever its timestamp.
  2. **Same-head ordering:** `stored meta IS NULL OR stored meta.head_sha <> excluded meta.head_sha OR stored meta.generated_at <= excluded meta.generated_at` (fixed-width `toISOString()` strings).
  `generated_at` is captured at flight start BEFORE the pull/inputs are read. When the write is skipped, the service re-reads and returns the stored state (freshness then shows `stale`/`fresh` correctly) instead of the discarded result.
- **A8** Focus click = `router.push(\`${pathname}?tab=diff&file=…&line=…\`)` built with URLSearchParams; `page.tsx` passes `file`/`line` to DiffTab as props.
- **A9** Seeded brief lives in new `server/src/db/seed-brief.ts`; `seed.ts` (which imports `context/constants`, `seed.ts:12`) only calls it and is outside the brief code path.
- **A10** AC-29 (429) test uses a second app with `nodeEnv:'production'` (`app.ts:104` skips rate limit under `test`).
- **A11** Model-output schema has no caps and uses `line: z.number()`; drops and caps happen in the validator (keeps AC-11/12/47 apart from AC-08).
- **A12** Token budget: truncation targets `BRIEF_ASSEMBLY_MAX_TOKENS = 7000` (~1,000 reserve for schema, provider tokenizer, overhead); hard limit `BRIEF_INPUT_MAX_TOKENS = 8000` is what AC-04 asserts.

## Architecture

- **Request path:** BriefCard → `usePrBrief` / `useRunBrief` (`client/src/lib/hooks/brief.ts`, new) → `GET`/`POST /pulls/:id/brief` (`brief/routes.ts`) → `BriefService`.
- **Cross-module reads (flagged for architecture-reviewer):** the brief module may import the pure `buildSmartDiff` (`reviews/smart-diff.ts:101`, `patch:null`, no findings) and construct `BlastService` from `container` (`blast/service.ts:15-19`; precedent: ReviewService/IntentService built the same way in `reviews/routes.ts:26-27`). Repositories only via the container (`container.reviewRepo.getIntentRow`, `reviews/repository.ts:145`) or its own `BriefRepository` (`server/docs/modules.md:84-86`).
- **getState (local reads only):** workspace-scoped pull (404) → row → `resolveFeatureModel(container, ws, 'risk_brief')` (`settings/feature-models.ts:51-57`) → freshness.
- **run order (as intent, `intent/service.ts:195-214`):** (1) pull 404; (2) no `pr_files` → 409, no LLM call; (3) resolve model → `container.llm(provider)`; ConfigError → 422 fixed text, no fallback — this runs BEFORE the cache check, so a key-less workspace gets 422 even with a fresh brief (AC-20 vs AC-17 consistent); (4) cache hit when not `force` and fresh; (5) single-flight key `prId|headSha|provider|model|BRIEF_PROMPT_VERSION` (`intent/service.ts:67-74,218-240`); (6) caller waits ≤ `BRIEF_TIMEOUT_MS`, then 504; the flight keeps running and saves (`:283-291`).
- **Flight:** gather metadata → `buildBriefMessages` (`wrapUntrusted`, `platform/prompt.ts:8`, plus a local copy of the 1-line `sanitize`, pattern `intent/prompt.ts:51`; intent untouched) → clip body to 1,500 tokens, truncate in D5 order to 7,000 (`container.tokenizer.count`, `tokenizer/index.ts:16-29`) → one `completeStructured({temperature:0, maxRetries:1, timeoutMs:0, maxTokens:2000})` (`maxTokens` passed through: `adapters.ts:61`, `openai.ts:31-37,74`, `anthropic.ts:71`) → Zod `safeParse` → path/line/ref filtering + caps → `cost = result.costUsd ?? priceBook.estimate` (`intent/service.ts:352`) → guarded upsert into `pr_brief.json` (`db/schema/reviews.ts:88-93`) → errors mapped to fixed `brief_*` messages (pattern `intent/failures.ts:80-106`).
- **Contracts (both copies, identical):** new `BriefReviewFocus`, `PrBriefMeta`; `PrBrief` gains optional `summary`, `review_focus` (max 8), `meta`; `history` optional; `Risks.risks` max 6; new `PrBriefState`.
- **Client:** card above `s.topRow` (`OverviewTab.tsx:18`); GET gated by `usePullSettled(prId, briefKey)` (`hooks/intent.ts:73`); DiffTab → DiffViewer → FileCard focus opens the card (`FileCard.tsx:57-59`) and calls `scrollIntoView` (scrolls the inner container); notice when the file is missing or the line is not a rendered new-side line (`diff-viewer/helpers.ts:12`); type-only barrel imports (client INSIGHTS 2026-10-15).

## Approvals required

T1 contract change (both copies) · T10 `seed.ts` change · T6 running integration (Docker) · T11 running e2e (`e2e.sh` migrates and seeds an isolated DB) · T12 paid manual run. No migration, schema, dependency or lockfile changes.

## Tasks

Checks shorthand: **[S]** `cd server && pnpm typecheck` → `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` · **[C]** `cd client && pnpm typecheck && pnpm test`

### T1 — Extend brief contracts in both copies — APPROVAL REQUIRED
- AC: AC-BRIEF-27 · contracts · implementer · Skills: engineering-insights, zod
- Files: M `server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`, `server/src/vendor/shared/contracts/review-api.ts`, `client/src/vendor/shared/contracts/review-api.ts` · Depends on: —
- Steps: add `BriefReviewFocus {path, line:int≥1, reason}`; `PrBriefMeta {head_sha, provider, model, prompt_version, tokens_in, tokens_out, cost_usd nullable, generated_at, truncated, intent_available}`; extend `PrBrief` (history optional; summary, review_focus max 8, meta optional; `Risks.risks` max 6); add `PrBriefState {pr_id, brief: PrBrief.nullable(), freshness: IntentFreshness, stale_reasons: IntentStaleReason[], model_error nullish}`; byte-identical in both copies.
- Acceptance: AC-BRIEF-27 changed blocks identical; a `PrBrief` without new fields still parses.
- Tests: none new (exercised by T3, T6, T8). Checks: `cd server && pnpm typecheck` → `cd client && pnpm typecheck && pnpm test`
- Risks: copy drift (server INSIGHTS 2026-10-11); optional `history` affects only `client/src/lib/types.ts:39`.
- Commit: C1 — `feat(contracts): extend PrBrief with summary, review focus, meta and PrBriefState`

### T2 — Brief constants and prompt/input builder
- AC: AC-BRIEF-03, 04, 05, 06, 25, 26, 49, 28 · server · implementer · Skills: engineering-insights, onion-architecture, security
- Files: A `server/src/modules/brief/constants.ts`, `server/src/modules/brief/prompt.ts`, `server/test/brief-prompt.test.ts`, `server/test/brief-boundary.test.ts` · Depends on: T1
- Steps: constants `BRIEF_PROMPT_VERSION='brief-v1'`, `BRIEF_FEATURE_ID='risk_brief'`, `BRIEF_INPUT_MAX_TOKENS=8000`, `BRIEF_ASSEMBLY_MAX_TOKENS=7000`, `BRIEF_BODY_MAX_TOKENS=1500`, `BRIEF_OUTPUT_MAX_TOKENS=2000`, `BRIEF_TIMEOUT_MS=60000`, `BRIEF_PROVIDER_TIMEOUT_MS=0`, `BRIEF_MAX_FOCUS=8`, `BRIEF_MAX_RISKS=6`, `BRIEF_TITLE_MAX_CHARS=300`, fixed messages; nothing from `modules/context`. `BriefGeneration` schema (A11), `clipToTokens`, local `sanitize`. `buildBriefMessages(input, tokenizer)` → `{messages, truncated}` (title, clipped body, file list, smart-diff group counts + per-file detail, blast summary (degraded: reason, no callers), intent or "intent: not available"); input type has no `patch`. Truncation to `BRIEF_ASSEMBLY_MAX_TOKENS`: callers → smart-diff detail → body → file-list tail.
- Tests (`brief-prompt.test.ts`): "AC-BRIEF-03 prompt has no patch text", "AC-BRIEF-04 messages ≤ 8000 tokens", "AC-BRIEF-05 truncates in D5 order and flags truncated", "AC-BRIEF-06 wraps every PR-derived string", "AC-BRIEF-25 states intent not available", "AC-BRIEF-26 degraded blast: reason, no callers", "AC-BRIEF-49 clips body to 1500 tokens". (`brief-boundary.test.ts`) "AC-BRIEF-28 no brief file imports context/constants" — scans every file under `server/src/modules/brief/` plus `server/src/db/seed-brief.ts` (`seed.ts` is outside the brief path, A9).
- Checks: [S] · Risks: provider `tokens_in` may exceed cl100k count → mitigated by A12; confirmed in T12. · Commit: C2 — `feat(brief): add brief constants and budgeted prompt builder`

### T3 — Output validation and freshness helpers
- AC: AC-BRIEF-09, 10, 11, 12, 47, 16 · server · implementer · Skills: engineering-insights, onion-architecture, security
- Files: A `server/src/modules/brief/helpers.ts`, `server/test/brief-helpers.test.ts` · Depends on: T2
- Steps: `validateBriefOutput(gen, changedPaths)` (drop focus with non-changed path or line not int ≥ 1, keep first 8; `file_refs` only `path` / `path:<int≥1>` with a changed path, only a trailing `:<digits>` parsed; keep first 6 risks; trim/bound strings); `evaluateBriefFreshness(brief, {headSha, model})`; `toStoredIntent(row)`.
- Tests: "AC-BRIEF-09 drops focus on non-changed path", "AC-BRIEF-10 drops invalid file_refs", "AC-BRIEF-11 drops non-integer/<1 lines", "AC-BRIEF-12 keeps first 8 focus", "AC-BRIEF-47 keeps first 6 risks", "AC-BRIEF-16 stale reason per head/model/prompt".
- Checks: [S] · Commit: C3 — `feat(brief): validate model output and evaluate freshness`

### T4 — Repository, failures and BriefService
- AC: AC-BRIEF-01, 02, 08, 21, 24, 45, 50, 43 · server · implementer · Skills: engineering-insights, onion-architecture, drizzle-orm-patterns, security
- Files: A `server/src/modules/brief/{repository,failures,service}.ts`, `server/test/brief-service.test.ts` · Depends on: T3
- Steps: `BriefRepository` (`getPull(ws, prId)` workspace-scoped; `listFiles(prId)` path/additions/deletions only; `getBriefRow`; `saveBrief` with the two-part A7 guard — current-head check + same-head `generated_at` ordering — returning whether the row was written; exported `buildSaveBriefQuery` so a unit test can read `.toSQL()` as intent does). `failures.ts`: `BriefTimeoutError` 504 `brief_timeout`, `BriefInputsIncompleteError` 409 `brief_inputs_incomplete`, `BriefModelUnavailableError` 422 `brief_model_unavailable`, `BriefSaveFailedError` 500, `mapBriefFailure` (fixed texts). `BriefService(container, opts{store?, blast?, timeoutMs?})` with `getState`/`run` in the documented order; never calls `IntentService`.
- Tests (`brief-service.test.ts`; header: no network; `vi.mock` feature-models; fake store/blast; `MockLLMProvider` for call-count tests 01, 02, 50; test-local FakeLLM for 08, 21, 24 (`costUsd: null`) and the gated slow call 45): "AC-BRIEF-01 one completeStructured call", "AC-BRIEF-02 resolves risk_brief model", "AC-BRIEF-08 invalid output persists nothing", "AC-BRIEF-21 LLM error keeps previous brief", "AC-BRIEF-24 cost falls back to priceBook", "AC-BRIEF-45 504 then flight saves", "AC-BRIEF-50 passes maxTokens 2000".
- Checks: [S] · Risks: single-flight copied exactly; `BlastService` reads `patch` internally but returns none. · Commit: C4 — `feat(brief): add brief repository and single-flight BriefService`

### T5 — Routes and module registration
- AC: AC-BRIEF-14, 15, 17, 18, 22, 23, 29 · server · implementer · Skills: engineering-insights, onion-architecture, fastify-best-practices
- Files: A `server/src/modules/brief/routes.ts` · M `server/src/modules/index.ts` · Depends on: T4
- Steps: GET/POST with `IdParams`, `getContext`; POST `config.rateLimit {max:10, timeWindow:'1 minute'}`, `IntentRunRequest.parse(req.body ?? {})` (pattern `reviews/routes.ts:142-155`); register in `modules` (`index.ts:28-41`).
- Tests: covered by T6 (thin routes). Checks: [S] · Commit: C5 — `feat(brief): expose GET/POST /pulls/:id/brief`

### T6 — Integration tests (running = APPROVAL REQUIRED)
- AC: AC-BRIEF-01, 07, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 29, 46, 43 · server · test-writer · Skills: engineering-insights, fastify-best-practices, drizzle-orm-patterns
- Files: A `server/test/brief.it.test.ts` · Depends on: T5
- Steps: harness as `blast.it.test.ts:43-71` (`startPg`, `seed`, `buildApp({db, overrides:{secrets: MockSecretsProvider({}), github: ForbiddenGitHub, llm:{openai: Mock or gated fake}}})`); own PR fixtures (not #482) + second workspace; missing-key app (no openai override, openrouter mock must see 0 calls); AC-29 app with `nodeEnv:'production'` and its own limiter — 11 POSTs on a PR with a fresh stored brief (cache hits, no LLM), 11th → 429.
- Tests: one `it('AC-BRIEF-xx …')` per listed AC (07 `pr_intent` count unchanged + no intent call; 13 row parses with all meta; 16 head_sha update, `risk_brief` override, old prompt_version; 19 two concurrent POSTs → 1 call; 20 422, row unchanged, 0 openrouter calls; 46 409, 0 calls, row unchanged) plus "AC-BRIEF-13/19 older flight cannot overwrite a newer row" (same head, older `generated_at`) and "AC-BRIEF-13/19 flight for a superseded head is not saved even with a later generated_at" (update `pull_requests.head_sha` between flight start and save; the stored row keeps the current-head brief).
- Checks: `cd server && pnpm typecheck`; APPROVAL: `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/brief.it.test.ts`
- Risks: dev DB / real GitHub reachable unless overridden (server INSIGHTS 2026-10-11, 2026-10-17). · Commit: C6 — `test(brief): cover brief endpoints with testcontainers`

### T7 — Client brief hooks
- AC: AC-BRIEF-39 · client · implementer · Skills: engineering-insights, frontend-architecture, react-best-practices, react-testing-library
- Files: A `client/src/lib/hooks/brief.ts`, `client/src/lib/hooks/brief.test.tsx` · M `client/src/lib/hooks/index.ts` · Depends on: T1
- Steps: `briefKey = (id: string | null | undefined) => ["pr-brief", id] as const`; `usePrBrief(prId, enabled)` GET; `useRunBrief(prId)` POST `{force}`, `retry:0`, `meta:{silent:true}`, `onSettled` invalidates `briefKey(prId)` (pattern `hooks/intent.ts:140-160`).
- Tests: "AC-BRIEF-39 invalidates brief key on success", "AC-BRIEF-39 invalidates brief key on error" (`waitFor`).
- Checks: [C] · Commit: C7 — `feat(client): add PR brief query and mutation hooks`

### T8 — BriefCard on Overview and i18n
- AC: AC-BRIEF-30, 31, 32, 33, 34, 35, 38, 48 · client · implementer · Skills: engineering-insights, frontend-architecture, react-best-practices, next-best-practices, react-testing-library
- Files: A `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/_components/BriefCard/{BriefCard.tsx,index.ts,helpers.ts,styles.ts,BriefCard.test.tsx}`, `…/OverviewTab/OverviewTab.test.tsx` · M `…/OverviewTab/OverviewTab.tsx`, `client/messages/en/brief.json` · Depends on: T7
- Steps: states loading / no brief (Generate `force:false`, disabled while pending) / brief (summary; risks with severity, title, explanation, refs; "Review focus (n)" `path:line — reason`; Refresh `force:true`) / stale indicator with reasons. `model_error` never hides brief or focus items — only disables Generate/Refresh and shows the API text. Errors show `ApiError.message` or fixed fallback and keep the brief. Never render `tokens_*`/`cost_usd`. Focus click → `router.push(focusHref(pathname, item))`. Card above `s.topRow`. `card.*` keys in brief.json.
- Tests (`BriefCard.test.tsx`, one `it` per AC): "AC-BRIEF-31 Generate sends one POST per click and shows loading", "AC-BRIEF-32 renders summary, risks and Review focus (n) as path:line — reason", "AC-BRIEF-32 model_error keeps brief and focus visible, disables Generate/Refresh", "AC-BRIEF-33 stale shows indicator and Refresh sends force:true", "AC-BRIEF-34 POST failure shows API message and keeps previous brief", "AC-BRIEF-35 focus click navigates to ?tab=diff&file&line", "AC-BRIEF-38 strings come from brief.json", "AC-BRIEF-48 no tokens or cost rendered"; (`OverviewTab.test.tsx`) "AC-BRIEF-30 brief card renders above Intent/Blast row".
- Checks: [C] · Risks: barrel value imports break `next build`; avoid `borderColor` shorthand. · Commit: C8 — `feat(client): add PR Brief card to the Overview tab`

### T9 — Files changed deep link (expand, scroll, notice)
- AC: AC-BRIEF-36, 37 · client · implementer · Skills: engineering-insights, frontend-architecture, react-best-practices, next-best-practices, react-testing-library
- Files: M `…/pulls/[number]/page.tsx`, `…/_components/DiffTab/DiffTab.tsx`, `…/DiffTab/DiffTab.test.tsx`, `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`, `client/src/components/diff-viewer/FileCard/FileCard.tsx`, `…/FileCard/FileCard.test.tsx`, `client/messages/en/prReview.json` · Depends on: —
- Steps: page passes `focusFile`/`focusLine` from `search.get` (`page.tsx:74`); DiffTab → DiffViewer → FileCard `focused`; focused file's group opens; notice (`prReview.smartDiff.focus*`) when file not in `files` or line not rendered; focused FileCard opens and runs `ref.current?.scrollIntoView?.({block:"start"})`.
- Tests: DiffTab "AC-BRIEF-36 opens and scrolls the focused file", "AC-BRIEF-37 notice for missing file", "AC-BRIEF-37 notice for line not in loaded diff"; FileCard "AC-BRIEF-36 focused card opens despite size" (stub `Element.prototype.scrollIntoView`).
- Checks: [C] · Risks: shared DiffViewer, optional prop. · Commit: C9 — `feat(client): deep-link Files changed to a focused file and line`

### T10 — Seed a fresh PR #482 brief — APPROVAL REQUIRED
- AC: AC-BRIEF-44, 41 (precondition), 28 · server · implementer · Skills: engineering-insights, drizzle-orm-patterns
- Files: A `server/src/db/seed-brief.ts` · M `server/src/db/seed.ts` · Depends on: T1, T2
- Steps: `seedBriefFixture(db, {prId, headSha})` inserts a full `PrBrief` (`onConflictDoNothing`): required `intent` (empty placeholder, A2); required `blast` (valid `BlastRadius`: `changed_symbols:[]`, `downstream:[]`, `summary`, `degraded:true`, `reason:'no_data'`); unique summary; 2 risks; 2 focus items `src/middleware/ratelimit.ts:12`, `src/config.ts:12`; meta `head_sha` = PR `headSha`, `BRIEF_PROMPT_VERSION`, `defaultFeatureModel('risk_brief')`, tokens/cost 0, `truncated:false`, `intent_available:false`, fixed past `generated_at` `2026-01-01T00:00:00.000Z`. `seed.ts` calls it after the PR block and OUTSIDE `if (!pr)` (`seed.ts:102`).
- Acceptance: row parses as `PrBrief`; GET reports `fresh` on a fresh seed (T11); no context import.
- Checks: [S]; `db:seed` runs only inside the approved e2e run. · Commit: C10 — `feat(seed): add fresh PR Brief fixture for PR #482`

### T11 — e2e flow over the seeded brief (running = APPROVAL REQUIRED)
- AC: AC-BRIEF-44, 41, 43 · e2e · test-writer · Skills: engineering-insights
- Files: A `e2e/specs/09-pr-brief.flow.json` · M `e2e/README.md` (coverage row) · M `e2e/CLAUDE.md` ("7 flows" at `:24`, "Number new flows 08-…" at `:49`) · Depends on: T8, T9, T10
- Steps: open → `/pulls` → `find text "#482" click` → `/pulls/482` → networkidle → wait seeded summary, a risk title, "Review focus (2)" → `find text "src/middleware/ratelimit.ts:12" click` → `wait --url tab=diff`, `file=`, `line=12` → wait focus notice.
- Acceptance: AC-BRIEF-44 brief shows with no LLM call; AC-BRIEF-41 proof = focus notice + `file=`/`line=` URL (forced expansion proven only by T9 RTL: seeded files ≤ 200 lines and without patches).
- Checks: `cd e2e && npm run typecheck`; APPROVAL: `./scripts/e2e.sh` · Commit: C11 — `test(e2e): cover seeded PR Brief and focus deep link`

### T12 — Manual paid verification — APPROVAL REQUIRED
- AC: AC-BRIEF-42 · main agent with the user · Depends on: T1–T11
- Steps: test agent setup, open PR with a real diff, Generate once, GET and read `meta`. Acceptance: `tokens_in` ≤ 8000, every focus path is a changed file. If `tokens_in` > 8000 despite A12 → SPEC_GAP. · Commit: none

## AC coverage

| AC-ID | Tasks | Test(s) | Verification |
|---|---|---|---|
| 01 | T4, T6 | brief-service.test.ts; brief.it.test.ts | unit + it |
| 02, 08, 21, 24, 45, 50 | T4 | brief-service.test.ts | unit |
| 03, 04, 05, 06, 25, 26, 49 | T2 | brief-prompt.test.ts | unit |
| 09, 10, 11, 12, 47 | T3 | brief-helpers.test.ts | unit |
| 16 | T3, T6 | brief-helpers.test.ts; brief.it.test.ts | unit + it |
| 13, 19 | T4, T6 | brief.it.test.ts (incl. older-flight guard) | it (approval) |
| 07, 14, 15, 17, 18, 20, 22, 23, 29, 46 | T5, T6 | brief.it.test.ts | it (approval) |
| 27 | T1 | — | manual (diff of both copies) |
| 28 | T2, T10 | brief-boundary.test.ts | unit + manual |
| 30 | T8 | OverviewTab.test.tsx | RTL |
| 31, 32, 33, 34, 35, 38, 48 | T8 | BriefCard.test.tsx (one it each; 32 also model_error) | RTL (+ manual for 38) |
| 36, 37 | T9 | DiffTab.test.tsx, FileCard.test.tsx | RTL |
| 39 | T7 | hooks/brief.test.tsx | unit |
| 41, 44 | T10, T11 | 09-pr-brief.flow.json | e2e (approval) |
| 42 | T12 | — | manual paid (approval) |
| 43 | T4, T6, T11 | — | manual (code review) |
| 40 | — | — | Withdrawn |

## Commits (proposed; created only on the user's request)

| Commit | Tasks | Message |
|---|---|---|
| C1 | T1 | feat(contracts): extend PrBrief with summary, review focus, meta and PrBriefState |
| C2 | T2 | feat(brief): add brief constants and budgeted prompt builder |
| C3 | T3 | feat(brief): validate model output and evaluate freshness |
| C4 | T4 | feat(brief): add brief repository and single-flight BriefService |
| C5 | T5 | feat(brief): expose GET/POST /pulls/:id/brief |
| C6 | T6 | test(brief): cover brief endpoints with testcontainers |
| C7 | T7 | feat(client): add PR brief query and mutation hooks |
| C8 | T8 | feat(client): add PR Brief card to the Overview tab |
| C9 | T9 | feat(client): deep-link Files changed to a focused file and line |
| C10 | T10 | feat(seed): add fresh PR Brief fixture for PR #482 |
| C11 | T11 | test(e2e): cover seeded PR Brief and focus deep link |

## Order

Server: T1 (approval) → T2 → T3 → T4 → T5 → T6 (written now, run after approval). After T1: client T7 → T8 alongside. T9 any time. T10 (approval) after T2. T11 after T8, T9, T10. T12 last. Package checks never in parallel.

## Final verification

1. `cd server && pnpm typecheck`
2. `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
3. `cd client && pnpm typecheck && pnpm test`
4. `cd e2e && npm run typecheck`
5. APPROVAL: `cd server && DATABASE_URL=postgres://guard@127.0.0.1:1/do_not_use pnpm exec vitest run test/brief.it.test.ts`
6. APPROVAL: `./scripts/e2e.sh`
7. Recommended: `cd client && pnpm build` (value-import guard)
- Manual (user): card layout vs screenshots, Refresh/stale states, deep-link scroll inside the inner container.

## For reviewers

- **architecture-reviewer:** cross-module imports (pure `buildSmartDiff`; `BlastService` from container) vs `modules.md:84-86`; A1 placement and A3 extra files; single-flight fidelity and run order (422 before cache); A7 guard; optional prop on shared DiffViewer/FileCard.
- **security-reviewer:** `wrapUntrusted` + `sanitize` on every PR-derived string; no `patch` in the brief repository; model paths become links only after the changed-file check, never used for FS access; fixed error texts (`mapBriefFailure`); workspace scoping before `getBriefRow` (`pr_brief` has no workspace column); 422 path has no fallback model.
- **plan-verifier:** every unit/RTL AC has an AC-prefixed `it`; AC-27, 28, 43 code review; AC-42 paid manual; AC-29 relies on A10.

## Retries vs "exactly one call" (checked 2026-10-18)

- The approved spec defines "one call" as one `completeStructured` invocation with internal schema-repair retries included (spec D4, §8 call settings, AC-BRIEF-01). The plan keeps `maxRetries: 1` and AC-01 counts `completeStructured` invocations; this matches the spec, so it is not changed here.
- Strictly one provider HTTP request is NOT what the spec requires, and `maxRetries: 0` would not guarantee it either: each attempt is wrapped in `withRetry` (up to 3 transport retries on retryable errors; `server/src/adapters/llm/openai.ts:96-110`, `server/src/platform/resilience.ts:46-64`). Switching to a strict one-request rule would need a spec amendment (D4/AC-01) and an adapter option.
- **SPEC_GAP (reported to the user, not resolved here):** the adapter sums `tokens_in` over schema-repair attempts (`openai.ts:111`). With `maxRetries: 1`, a repair attempt roughly doubles `tokens_in` (≈ 2 × 7,000), so AC-BRIEF-42 ("`tokens_in` ≤ 8,000") can fail even though each request is within budget. Options need a spec decision: (a) `maxRetries: 0`; (b) AC-42 measures per-attempt input / requires `attempts = 1`; (c) keep as is and accept.

## Unknowns

None.

## Limitations

Read-only planning; skill files not opened; `e2e/specs/review-flow.md` and `server/docs/testing.md` not read in full.
