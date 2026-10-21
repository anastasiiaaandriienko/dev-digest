# Spec: PR Why + Risk Brief (HW-05)
- **Key:** BRIEF · **Status:** Approved (2026-10-18) · amended 2026-10-18 (D18, AC-BRIEF-42 clarified) · **Date:** 2026-10-18 · **Packages:** server | client | contracts
- **Source request:** HW-05 "PR Why + Risk Brief": a PR Brief card on the PR Overview tab. It combines existing Intent (L03), Smart Diff (L03) and Blast Radius (HW-04) with a newly generated summary ("why"), risks and review focus. Relayed by the main agent on behalf of the user.
- **Requirement-source limitation:** the original HW-05 assignment text is not in the repo. The only repo mention is `README.md:88` ("L05 | … · PR Brief card"). Requirements come only from the relayed request and the user's decisions in §14.

## 1. Goals
- G1. Show a PR Brief card on the Overview tab, placed above the Intent/Blast row. It shows a generated summary (the "why"), risks and review focus.
- G2. Review focus items read `path:line — reason`. Clicking one opens Files changed at `?tab=diff&file=<path>&line=<n>`.
- G3. Generate / Refresh actions. The result is stored in `pr_brief` and survives reloads. It is marked stale when the PR head SHA changes.
- G4. Exactly one `completeStructured` call. The model comes from `resolveFeatureModel(container, workspaceId, 'risk_brief')`. Input is pre-computed metadata only (no raw diff hunks), at most 8,000 tokens per provider attempt (D18).
- G5. The model output is checked with Zod. Every returned path must be one of the PR's changed files.
- G6. Works with the existing `pr_brief` table (no migration) and extends the existing contracts. Tests make no paid calls.

## 2. Non-goals
- Generating or refreshing Intent from the brief flow. The brief never triggers intent generation (D3).
- Changing Smart Diff, Blast Radius, `reviewer-core`, review agents or `devdigest-mcp/` (no new MCP tool).
- Project Context limits or injection. PR Brief owns its budget (`specs/project-context-folder/spec.md:16`, AC-CTX-67 at `:221`).
- Mockup extras: the verdict-style header, PR score ring, cost/tokens line, "Prior PRs touching these files" and changes to the existing IntentBlock (D9).
- PR history: `history` is not filled (D1). `WhyTimeline` / git-why is out of scope (D15).
- Showing tokens or cost in the UI (D12).
- Generating the brief automatically on page open or on repo sync (D-A3).

## 3. Actors and triggers
| Actor | Trigger | Effect |
|---|---|---|
| Studio user (workspace member) | Opens PR → Overview tab | `GET /pulls/:id/brief` (local read, no LLM) |
| Studio user | Clicks **Generate** (no brief) or **Refresh** (any brief) | `POST /pulls/:id/brief` → one LLM call, or a cache hit |
| Studio user | Clicks a review focus item | Client navigates to `?tab=diff&file=…&line=…` |
| Server (`modules/brief`) | `POST` handler | Gathers metadata → budget → LLM → validate → upsert |
| Repo sync / PR re-import | Head SHA changes | Next `GET` reports `stale` (no automatic regeneration) |

## 4. Current state (verified, path:line)
- `pr_brief` table: `pr_id uuid PK → pull_requests.id ON DELETE CASCADE`, `json jsonb NOT NULL`, no other columns (`server/src/db/schema/reviews.ts:88-93`).
- No brief module exists. The registry names "brief/context/onboarding" as future lessons (`server/src/modules/index.ts:24-27`). Registered modules: `:28-41`.
- `PrBrief = {intent, blast, risks, history}` (`server/src/vendor/shared/contracts/brief.ts:175-180`). `Risk {kind: string, title, explanation, severity: high|medium|low, file_refs: string[]}` (`:98-108`). `PrHistory` (`:116-129`). The client copy matches at these lines (`client/src/vendor/shared/contracts/brief.ts:101-107,175-181`).
- The `risk_brief` feature id exists (`contracts/platform.ts:15-21`). Default: openai / gpt-4.1 (`:59-65`). `resolveFeatureModel` returns the override or else the default, with no other fallback (`server/src/modules/settings/feature-models.ts:51-57`). The only `risk_brief` references in `server/src` are in `platform.ts`.
- `StructuredRequest` / `StructuredResult`: `server/src/vendor/shared/adapters.ts:55-80`.
- Intent pattern to mirror:
  - `GET`/`POST /pulls/:id/intent`. POST is rate-limited to 10/min and takes `{force}` (`server/src/modules/reviews/routes.ts:139-155`).
  - `PrIntentState`: freshness `fresh|stale|unknown`, `stale_reasons: pr_changed|model_changed|prompt_changed` (`contracts/review-api.ts:65,75,148-162`). Evaluation: `reviews/intent/freshness.ts:41-53`.
  - The single-flight key includes the prompt version (`intent/service.ts:73`).
  - The `completeStructured` call uses `temperature: 0`, `maxRetries: 1`, `timeoutMs: INTENT_PROVIDER_TIMEOUT_MS` (= 0, no adapter race) (`intent/service.ts:339-347`, `intent/constants.ts:41`).
  - Each HTTP caller waits at most `INTENT_TIMEOUT_MS` = 60,000 ms (`constants.ts:30`, `service.ts:283-291`). On timeout it gets 504 with a fixed message, while the flight keeps running and still saves (`failures.ts:22`, `constants.ts:25-29,44-45`).
  - On `ConfigError` it returns fixed, user-safe text (`service.ts:329-334`). It re-checks Zod (`:349-350`). Cost: `result.costUsd ?? priceBook.estimate(...)` (`:352`).
  - Untrusted text is wrapped with `wrapUntrusted` (`intent/prompt.ts:180-183`).
  - If PR files are not synced, intent returns 409 (`failures.ts:29`).
  - Intent's model resolution is different from the brief's: it uses an override with an onboarding fallback (`service.ts:94-104`, `intent/model.ts:42`). The brief uses `resolveFeatureModel` with no fallback (D11).
- Smart Diff: `GET /pulls/:id/smart-diff` is a local read (`reviews/routes.ts:133-137`), built by pure `buildSmartDiff` (`reviews/smart-diff.ts:101`). Contract: `contracts/brief.ts:131-172`.
- Blast: `GET /pulls/:id/blast` (read-only, no LLM) (`server/src/modules/blast/routes.ts:8-23`). It has `degraded`, `reason` and `source` (`contracts/brief.ts:90-94`).
- Tokenizer: `Tokenizer.count(text)` (`server/src/adapters/tokenizer/index.ts:16-29`). `MockLLMProvider.calls` records `completeStructured` (`server/src/adapters/mocks.ts:58-90`).
- Overview tab: Intent and Blast side by side, then Description; there is no brief card (`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:14-30`). The tab is the `?tab` query (`.../pulls/[number]/page.tsx:74,82,165,193`).
- Files changed: there is no deep link. No `useSearchParams` or `scrollIntoView` exists under `pulls/[number]/_components` except `ReviewRunAccordion.tsx:50` (grep). The DiffTab has local toggles only (`DiffTab.tsx:46,49`).
- The i18n scaffold `client/messages/en/brief.json:1-19` exists and is unused.
- Seed: the only PR is #482, head_sha `a1b2c3d4e5f6`, with 4 `pr_files` and no patches (`server/src/db/seed.ts:97-128`). No `pr_brief` row is seeded.
- e2e uses no LLM and no API key (`e2e/CLAUDE.md:11`).

## 5. Inputs and provenance
| Input | Source | Trust | Validation / limits |
|---|---|---|---|
| `:id` | URL | untrusted | `IdParams` uuid → 422; workspace-scoped → 404 |
| `force` | POST body | untrusted | tolerant parse like `IntentRunRequest`, default `false` |
| PR title, body | `pull_requests` | untrusted | `wrapUntrusted`; body clipped to `BRIEF_BODY_MAX_TOKENS = 1500` before budget truncation (D17) |
| Changed files (path, additions, deletions) | `pr_files` | untrusted names | define the allowed-path set; `wrapUntrusted`; none stored → 409, no LLM call (D16) |
| Smart Diff groups / split suggestion | `buildSmartDiff` | derived | roles from the contract enum |
| Stored intent | `pr_intent` (read only) | model output over untrusted text | `wrapUntrusted`; if missing, the input says "intent: not available" (D3) |
| Blast summary (symbols, callers, endpoints, degraded/reason) | blast service | derived | callers are context only; their files are not allowed paths (D6) |
| Raw diff hunks / `patch` | `pr_files` | untrusted | **never read or sent** (AC-BRIEF-03) |
| Model | `resolveFeatureModel(..., 'risk_brief')` | trusted config | missing key → 422 (D11) |
| LLM output | provider | untrusted | Zod + changed-file paths + line ≥ 1 + caps (FR-5) |

## 6. Outputs (contracts, UI, persistence, trace)
- **Contract (D1), identical in both `vendor/shared` copies.** `PrBrief` gains optional fields:
  - `summary: string`.
  - `review_focus: {path, line: int ≥ 1, reason}[]` (≤ 8).
  - `meta: {head_sha, provider, model, prompt_version, tokens_in, tokens_out, attempts, cost_usd, generated_at, truncated, intent_available}`. `tokens_in`/`tokens_out` are the adapter's cumulative totals over all attempts, `attempts` is `StructuredResult.attempts`, and `cost_usd` is computed from the cumulative totals (D18).
  - `history` becomes optional and is not filled. `risks.risks` holds ≤ 6 entries. `Risk.file_refs` entries are `path` or `path:line`.
  - New `PrBriefState {pr_id, brief|null, freshness, stale_reasons, model_error?}` reuses `IntentFreshness` and `IntentStaleReason`.
- **Persistence (D2):** one `pr_brief` row per PR. `json` holds the validated `PrBrief` including `meta`. No migration.
- **UI:** a PR Brief card above the Intent/Blast row. It shows the summary, the risks (severity, title, explanation, refs), "Review focus (n)" items, Generate/Refresh, and stale/error/loading states. Tokens and cost are not shown (D12).
- **Trace:** none. No `run_traces` row; usage lives only in `meta`.

## 7. Functional requirements
- FR-1 `GET` state (no LLM) → AC-BRIEF-14, 15, 16, 22, 23
- FR-2 `POST`: cache hit, force, single-flight, rate limit, caller timeout → AC-BRIEF-01, 17, 18, 19, 29, 45
- FR-3 Input assembly: no hunks, 4,500-token assembly budget (8k per attempt), fixed truncation order, untrusted wrapping, no intent generation, no files synced → AC-BRIEF-03, 04, 05, 06, 07, 25, 26, 46, 49
- FR-4 Model, output limit and cost → AC-BRIEF-02, 24, 50
- FR-5 Output validation: Zod, paths, lines, caps → AC-BRIEF-08, 09, 10, 11, 12, 47
- FR-6 Persistence and freshness → AC-BRIEF-13, 16
- FR-7 Failures (missing key, LLM error) → AC-BRIEF-20, 21
- FR-8 Contracts, CTX boundary, no paid tests → AC-BRIEF-27, 28, 43
- FR-9 Overview card UI → AC-BRIEF-30, 31, 32, 33, 34, 38, 39, 48
- FR-10 Navigation to Files changed → AC-BRIEF-35, 36, 37
- FR-11 e2e and manual paid → AC-BRIEF-41, 42, 44

## 8. Constraints
- **Budget (D4, D18, D19):** these constants live in `server/src/modules/brief/constants.ts`.
  - `BRIEF_INPUT_MAX_TOKENS = 8000` is the input limit for each provider attempt, not cumulative.
  - The server builds the prompt to `BRIEF_ASSEMBLY_MAX_TOKENS = 4500`: all system + user messages, counted with `container.tokenizer.count`. That is 8,000 − 2,000 (`BRIEF_OUTPUT_MAX_TOKENS`, the raw output the adapter appends on a repair attempt) − 1,500 reserve (reprompt text plus schema and provider-tokenizer overhead). This way both the first attempt and the single repair attempt stay within 8,000.
  - Residual risk: the reprompt length grows with the number of Zod issues and is not capped by code. The 1,500 reserve is a design allowance, not a guarantee (D19).
- **Size constants (D17), in `server/src/modules/brief/constants.ts`:** `BRIEF_BODY_MAX_TOKENS = 1500` (the PR body is clipped to this before assembly, inside the 4,500 assembly budget) and `BRIEF_OUTPUT_MAX_TOKENS = 2000` (passed as `maxTokens` to `completeStructured`).
- **Truncation order (D5):** blast callers → smart-diff detail (per-file entries, keeping group counts) → PR body → tail of the file list. Title and intent are never dropped.
- **Caps (D7):** ≤ 8 review focus items, ≤ 6 risks. `Risk.kind` is free text.
- **Call settings (D4, as intent):** `temperature: 0`, `maxRetries: 1`, provider `timeoutMs: 0`. Caller wait is `BRIEF_TIMEOUT_MS = 60000`. Schema-repair retries inside the one `completeStructured` call count as one call.
- **Module (D13):** `server/src/modules/brief/` with `routes.ts`, `service.ts` (`BriefService`), `repository.ts`, `helpers.ts`, `constants.ts`, registered in `modules/index.ts`. No import from `server/src/modules/context/constants.ts` (AC-CTX-67).
- No migration, no schema change, no new dependency, no lockfile change. Contract edits go into both copies together.
- Every query is scoped by `workspaceId`. Errors are `AppError` subclasses.

## 9. Security
- Every PR-derived string (title, body, paths, intent text, blast symbol names) goes into the prompt through `wrapUntrusted`, sanitised as in `intent/prompt.ts:180-183`.
- Model output is untrusted. Paths not in the changed-file set are dropped, never rendered as links, and never used for file-system access.
- Workspace scoping on GET and POST (other workspace → 404).
- No secrets in the prompt, the stored JSON or error text. ConfigError and provider errors map to fixed messages.

## 10. Performance
- One LLM call per generation. GET makes zero LLM and zero GitHub calls.
- Input ≤ 8,000 tokens per provider attempt, not cumulative (D18). The server-assembled messages are ≤ 4,500 tokens, leaving headroom for a repair attempt (D19). The PR body is ≤ 1,500 tokens of that. Output `maxTokens` = `BRIEF_OUTPUT_MAX_TOKENS` = 2,000 (AC-BRIEF-49, AC-BRIEF-50).
- Each HTTP caller waits ≤ 60 s, then gets 504 while the flight continues and saves (AC-BRIEF-45).
- POST is rate-limited to 10 per minute (D8).

## 11. Error handling and failure modes
| Failure | Behaviour | AC |
|---|---|---|
| Invalid id | 422 | 23 |
| PR missing / other workspace | 404 | 22 |
| No brief stored | `brief: null`, `freshness: unknown`; UI shows Generate | 15, 31 |
| Head SHA changed | `stale` + `pr_changed`; old brief shown with Refresh | 16, 33 |
| Prompt version or model changed | `stale` + `prompt_changed` / `model_changed` | 16 |
| No key for the `risk_brief` provider | 422 with a fixed message, no fallback; row unchanged | 20 |
| LLM error | user-safe error; previous brief kept | 21, 34 |
| Caller wait > 60 s | 504 with a fixed message; the flight still saves | 45 |
| Output fails Zod | error; nothing persisted | 08 |
| Path not a changed file / line < 1 | item or ref dropped | 09, 10, 11 |
| Over caps | keep the first 8 focus items / 6 risks | 12, 47 |
| Intent missing | generate; input and `meta.intent_available = false` say so | 25 |
| Blast degraded | input states the reason; no callers | 26 |
| Input over budget | truncate in D5 order; `meta.truncated = true` | 05 |
| Concurrent POSTs | single-flight → one call | 19 |
| PR files not synced (no `pr_files`) | 409 with a fixed message, in the style of intent's `intent_inputs_incomplete` (`intent/failures.ts:29`); no LLM call; row unchanged (D16) | 46 |
| Focus file/line not in the loaded diff | notice; tab renders normally | 37 |

## 12. Acceptance criteria (EARS)
| AC-ID | EARS statement | Verification |
|---|---|---|
| AC-BRIEF-01 | When `POST /pulls/:id/brief` regenerates, the server shall issue exactly one `completeStructured` call (internal schema-repair retries included). | unit + integration (approval) |
| AC-BRIEF-02 | When generating, the server shall resolve provider/model via `resolveFeatureModel(container, workspaceId, 'risk_brief')`. | unit |
| AC-BRIEF-03 | The brief prompt shall contain no `pr_files.patch` content or diff hunk text. | unit |
| AC-BRIEF-04 | The brief's assembled system + user messages shall together measure ≤ 4,500 tokens (`BRIEF_ASSEMBLY_MAX_TOKENS`) with `container.tokenizer.count`, so the first provider attempt is ≤ 8,000 with the D19 headroom left for a repair attempt. | unit |
| AC-BRIEF-05 | If assembled metadata exceeds 4,500 tokens (`BRIEF_ASSEMBLY_MAX_TOKENS`), then the server shall drop content in the order blast callers → smart-diff detail → PR body → tail of the file list until it fits, and set `meta.truncated = true`. | unit |
| AC-BRIEF-06 | The server shall wrap every PR-derived string in the prompt with `wrapUntrusted`. | unit |
| AC-BRIEF-07 | When generating a brief, the server shall not call the intent LLM or write `pr_intent`. | integration (approval) |
| AC-BRIEF-08 | If the model output fails Zod validation, then the server shall return a user-safe error and persist nothing. | unit |
| AC-BRIEF-09 | If a review focus item's `path` is not one of the PR's changed files, then the server shall drop that item. | unit |
| AC-BRIEF-10 | If a `Risk.file_refs` entry is not `path` or `path:line` with `path` a changed file and line ≥ 1, then the server shall drop that entry. | unit |
| AC-BRIEF-11 | If a review focus `line` is not an integer ≥ 1, then the server shall drop that item. | unit |
| AC-BRIEF-12 | If the model returns more than 8 valid review focus items, then the server shall keep only the first 8. | unit |
| AC-BRIEF-13 | When generation succeeds, the server shall upsert `pr_brief.json` with the validated brief and `meta` (head_sha, provider, model, prompt_version, tokens_in, tokens_out, attempts, cost_usd, generated_at, truncated, intent_available), with `tokens_in`, `tokens_out` and `attempts` taken unchanged from the adapter's `StructuredResult`. | integration (approval) |
| AC-BRIEF-14 | When `GET /pulls/:id/brief` is called and a row exists, the server shall return it without any LLM or GitHub call. | integration (approval) |
| AC-BRIEF-15 | When `GET` is called and no row exists, the server shall return `brief: null`, `freshness: unknown`. | integration (approval) |
| AC-BRIEF-16 | While the PR head SHA, the resolved model or the prompt version differs from `meta`, the server shall report `freshness: stale` with `pr_changed`, `model_changed` or `prompt_changed` respectively. | unit + integration (approval) |
| AC-BRIEF-17 | When `POST` has `force: false` and the stored brief is fresh, the server shall return it without an LLM call. | integration (approval) |
| AC-BRIEF-18 | When `POST` has `force: true`, the server shall regenerate even if the brief is fresh. | integration (approval) |
| AC-BRIEF-19 | While a generation for a PR is in flight, the server shall serve concurrent `POST`s for that PR from the same single call. | integration (approval) |
| AC-BRIEF-20 | If the `risk_brief` provider has no API key, then the server shall respond 422 with a fixed user-safe message, use no fallback model, and leave the row unchanged. | integration (approval) |
| AC-BRIEF-21 | If the LLM call errors, then the server shall return a user-safe error and keep the previously stored brief. | unit |
| AC-BRIEF-22 | If the PR does not belong to the caller's workspace, then the server shall respond 404 on GET and POST. | integration (approval) |
| AC-BRIEF-23 | If `:id` is not a uuid, then the server shall respond 422. | integration (approval) |
| AC-BRIEF-24 | When generation succeeds, the server shall store `cost_usd = result.costUsd ?? priceBook.estimate(model, tokensIn, tokensOut)`. | unit |
| AC-BRIEF-25 | If no stored intent exists, then the server shall still generate, state "intent not available" in the input, and set `meta.intent_available = false`. | unit |
| AC-BRIEF-26 | If the blast radius is `degraded`, then the brief input shall state the degraded reason and include no callers. | unit |
| AC-BRIEF-27 | The brief contract changes shall be identical in `server/src/vendor/shared` and `client/src/vendor/shared`. | manual (code review) |
| AC-BRIEF-28 | No PR Brief code path shall import `server/src/modules/context/constants.ts`. | manual (code review) |
| AC-BRIEF-29 | If more than 10 `POST`s arrive within one minute, then the server shall respond 429. | integration (approval) |
| AC-BRIEF-30 | The Overview tab shall render the PR Brief card above the Intent/Blast row. | unit (RTL) |
| AC-BRIEF-31 | While no brief exists, the card shall show a Generate button that sends one `POST` per click and shows a loading state until it settles. | unit (RTL) |
| AC-BRIEF-32 | While a brief exists, the card shall show the summary, the risks, and "Review focus (n)" with each item rendered as `path:line — reason`. | unit (RTL) |
| AC-BRIEF-33 | While the brief is stale, the card shall show a stale indicator and a Refresh button that sends `force: true`. | unit (RTL) |
| AC-BRIEF-34 | If `POST` fails, then the card shall show the API's user-safe message and keep any previous brief visible. | unit (RTL) |
| AC-BRIEF-35 | When the user clicks a review focus item, the client shall navigate to `?tab=diff&file=<path>&line=<n>`. | unit (RTL) |
| AC-BRIEF-36 | When Files changed opens with `file` and `line` params, the client shall expand that file's card and scroll it into view. | unit (RTL) |
| AC-BRIEF-37 | If the `file` or `line` param is not in the loaded diff, then Files changed shall show a notice and render normally. | unit (RTL) |
| AC-BRIEF-38 | The card shall take every user-facing string from `client/messages/en/brief.json`. | unit (RTL) + manual |
| AC-BRIEF-39 | When a Generate/Refresh mutation settles, the client shall invalidate that PR's brief query key. | unit |
| AC-BRIEF-40 | **Withdrawn** (conflicts with D14: PR #482 now has a seeded brief, so its no-brief state can't be shown in e2e; the no-brief state is covered by AC-BRIEF-31). | — |
| AC-BRIEF-41 | Where the seeded brief for PR #482 exists, clicking a review focus item shall open Files changed with that file's card expanded. | e2e (approval) |
| AC-BRIEF-42 | When a user-approved paid run generates a brief on a real open PR, each provider attempt's input shall be within 8,000 tokens and every review focus path shall be one of the PR's changed files. Evidence: if `meta.attempts = 1`, then `meta.tokens_in` (the provider-reported input of that single attempt) shall be ≤ 8,000. If `meta.attempts > 1`, then `meta.tokens_in` is the adapter's sum over attempts and can't be split per attempt. In that case the check falls back to the server's pre-call count of the assembled messages (≤ 4,500, AC-BRIEF-04), and the run is repeated until a sample with `meta.attempts = 1` is observed. Per-attempt input is not estimated. The repair-attempt caveat is recorded in D18 / Q17. | manual (paid, approval) |
| AC-BRIEF-43 | The brief's unit, integration and e2e tests shall use `MockLLMProvider` or no LLM, and make no network call to a provider. | manual (code review) |
| AC-BRIEF-44 | When seeded PR #482 is opened in the hermetic stack, the Overview shall show the seeded brief (summary, risks, review focus) without any LLM call. | e2e (approval) |
| AC-BRIEF-45 | If a generation exceeds the 60 s caller wait, then the server shall respond 504 with a fixed message, and the flight shall still save its result. | unit |
| AC-BRIEF-46 | If the PR has no stored `pr_files` rows, then `POST /pulls/:id/brief` shall respond 409 with a fixed user-safe message, make no LLM call, and leave `pr_brief` unchanged. | integration (approval) |
| AC-BRIEF-47 | If the model returns more than 6 valid risks, then the server shall keep only the first 6. | unit |
| AC-BRIEF-48 | The card shall not render tokens or cost. | unit (RTL) |
| AC-BRIEF-49 | If the PR body exceeds 1,500 tokens (`container.tokenizer.count`), then the server shall clip it to at most 1,500 tokens before budget truncation. | unit |
| AC-BRIEF-50 | When generating, the server shall pass `maxTokens: 2000` to `completeStructured`. | unit |

## 13. Test scenarios
- T1 unit, input builder: fixture with patches → no patch text, wrapped fields, ≤ 4,500 tokens. Oversize fixture → D5 order and flag. Fixtures with no intent and degraded blast. A body over 1,500 tokens is clipped → 03, 04, 05, 06, 25, 26, 49.
- T2 unit, validator: unknown path, line 0, bad `file_refs`, 9 focus items / 7 risks, Zod-invalid output → 08–12, 47.
- T3 unit, service with `MockLLMProvider` + a fake slow provider: one call with `maxTokens: 2000`, `risk_brief` model, cost fallback, error keeps the old row, 504 then saved → 01, 02, 21, 24, 45, 50.
- T4 unit, freshness: same SHA/model/version → fresh; each differing → its reason → 16.
- T5 integration (testcontainers, approval): GET empty/existing; POST cache hit/force; single-flight; 404/422/429; missing key 422; no `pr_intent` write; no files → 07, 13–20, 22, 23, 29, 46.
- T6 client RTL: card position, empty/loading/fresh/stale/error states, no cost, focus click → URL, DiffTab deep link expand/scroll/notice, i18n, invalidation → 30–39, 48.
- T7 e2e (approval, after the seed approval): new flow over PR #482 showing the seeded brief, then focus click → Files changed → 41, 44.
- T8 manual paid run (separate approval; test agent setup, an open PR with a real diff) → 42.
- T9 code review → 27, 28, 43.

## 14. Decisions (user, 2026-10-18)
- D1 (Q1, A1): extend `PrBrief` in both copies with optional `summary`, `review_focus`, `meta`, and add `PrBriefState`. `history` is optional and not filled.
- D2 (Q2, A4): freshness metadata lives inside `pr_brief.json`. No migration.
- D3 (Q3, A2): generate without intent and flag it. The brief only reads stored intent, Smart Diff and blast, and never triggers intent generation.
- D4 (Q4): 8k covers system + user (refined by D18: per attempt; and D19: assembled to 4,500). `timeoutMs`/`maxRetries` as intent (`intent/service.ts:344-346`, `constants.ts:30,41`). Schema-repair retries inside the call count as one call.
- D5 (Q5): input = title, clipped body, file list with stats, smart-diff groups, blast summary, intent. Truncation order: blast callers → smart-diff detail → body → file-list tail.
- D6 (Q6): PR-head new-side line ≥ 1. Paths limited to changed files. `Risk.file_refs` is `path` or `path:line`, checked against changed files.
- D7 (Q7): ≤ 8 review focus items, ≤ 6 risks, `Risk.kind` free text.
- D8 (Q8, A5): routes `GET`/`POST /pulls/:id/brief`; POST rate limit 10/min.
- D9 (Q9): card above the Intent/Blast row. Mockup extras are non-goals.
- D10 (Q10): deep link `?tab=diff&file=<path>&line=<n>`; expand + scroll; notice when missing.
- D11 (Q11): missing `risk_brief` key → 422; no fallback.
- D12 (Q12): tokens/cost only in `meta`; not shown in the UI.
- D13 (Q13): new module `server/src/modules/brief/`.
- D14 (Q14): seed a `pr_brief` row for PR #482 (`meta.head_sha = a1b2c3d4e5f6`, current prompt version, default model, so it reads as fresh) for e2e. The hermetic e2e stack seeds through `server/src/db/seed.ts` (`scripts/e2e.sh:149-150`, `.github/workflows/e2e-web.yml:77-82`), so the row goes there. The seed change needs separate approval.
- D15 (Q15): "Why" = the generated `summary`. `WhyTimeline` is out of scope.
- D16 (Q16): no stored `pr_files` → POST returns 409 with a fixed message, in the code/shape style of intent's `intent_inputs_incomplete` (`intent/failures.ts:29`). No LLM call.
- D17 (plan values): `BRIEF_BODY_MAX_TOKENS = 1500`; `BRIEF_OUTPUT_MAX_TOKENS = 2000`, passed as `maxTokens`.
- D18 (SPEC_GAP, option B, 2026-10-18): `maxRetries: 1` stays as in D4. Transport retries (`withRetry`) and the LLM adapters are not changed.
  - The 8,000 input-token limit applies to each individual provider attempt, not to the cumulative `tokens_in`.
  - `meta.tokens_in`/`tokens_out` record the adapter's cumulative totals unchanged, and `cost_usd` uses them. The adapter sums usage per attempt (`server/src/adapters/llm/openai.ts:112-113`) and returns `attempts: attempt` (`:124`). The type field is `StructuredResult.attempts: number` (`server/src/vendor/shared/adapters.ts:79`).
  - `meta.attempts` records that value, so AC-BRIEF-42 can be checked.
  - Verified caveat: on a schema-repair attempt the adapter appends the previous raw output and a reprompt message to the messages (`openai.ts:128-129`, `anthropic.ts:140-144`). The OpenRouter provider does the same (`reviewer-core/src/llm/openrouter.ts:113`). So attempt 2's input is the assembled messages plus up to `BRIEF_OUTPUT_MAX_TOKENS` (2,000) plus the reprompt text. This is resolved by D19.
  - Usage from failed `withRetry` transport attempts is not part of the returned totals, because only the settled response's `usage` is added (`openai.ts:97-113`).
- D19 (Q17 → B, 2026-10-18): the 8,000 limit applies to EACH provider attempt. `maxRetries: 1` stays, with no adapter or transport changes.
  - The server builds the prompt to `BRIEF_ASSEMBLY_MAX_TOKENS = 4500` = 8,000 − 2,000 (`BRIEF_OUTPUT_MAX_TOKENS`, the raw output appended on repair) − 1,500 reserve (reprompt text plus schema and provider-tokenizer overhead).
  - `BRIEF_INPUT_MAX_TOKENS = 8000` stays the per-attempt limit. `BRIEF_BODY_MAX_TOKENS = 1500` is unchanged and fits inside 4,500.
  - The reprompt comes from `parseWithRepair` (`reviewer-core/src/llm/structured.ts:54-84`). It is either a fixed sentence plus the JSON parse error (`:67-71`) or a fixed sentence plus one line per Zod issue (`:76-82`).
  - Residual risk: the reprompt length grows with the number of Zod issues (and the parse-error text) and is not capped by code. The 1,500 reserve is a design allowance, not a guarantee.
  - AC-BRIEF-42's evidence rule (a `meta.attempts = 1` sample) stays as written in D18.
- D-A3: generation is manual only. D-A6: model or prompt-version changes also mark the brief stale.

## 15. Open questions
none (Q1–Q17 resolved; see §14).

## 16. Approvals required
- **UI gate (precondition):** client planning and implementation start only after the user provides screenshots of the CURRENT PR Overview and Files changed tabs. The mockups are visual reference only.
- Contract change in both `server/src/vendor/shared` and `client/src/vendor/shared` (D1).
- Seed change: a `pr_brief` row for PR #482 in `server/src/db/seed.ts`, which the hermetic e2e stack also uses (D14). Running `db:seed` needs separate approval.
- Running integration tests (Docker/testcontainers) and e2e (running stack + agent-browser).
- Manual paid LLM run for AC-BRIEF-42: explicit approval, test agent setup, an open PR with a real diff. Evidence rules and possible repeat runs (until a `meta.attempts = 1` sample) are in AC-BRIEF-42 / D18. Each repeat run is a paid call covered by this same approval; no new approval category.
- No migration and no schema change (D2). No dependency or lockfile changes.
