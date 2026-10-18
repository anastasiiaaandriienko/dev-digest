# Spec: Project Context Folder (L05)
- **Key:** CTX · **Status:** Approved (2026-10-18; amendment A1) · **Date:** 2026-10-18 · **Packages:** server | client | contracts (reviewer-core: tests only)
- **Approval history:** §1–§16 (AC-CTX-01..76) Approved 2026-10-18 (AC-CTX-46 revised); implemented and verified 75 PASS / 1 MISSING. Amendment A1 (§17, AC-CTX-77..106) Approved 2026-10-19 (G1); the approved content is unchanged except Q8 being marked superseded.
- **Source request:** User (Lab 05 / Stage 2): Markdown discovery with configurable roots; list, search, preview; agent and skill attachments; persist paths, not contents; runtime injection without an extra LLM call; injection guard + filesystem boundaries; trace + token accounting; degraded/missing-file behaviour; acceptance tests proving a reviewer uses an attached spec. Roadmap `README.md:88`.
- **Requirement sources and limitations:** requirements come only from the user's Stage 2 request and the user's decisions recorded in §15. The original Lab 05 assignment text was not available; no further mandatory features are assumed from it.

## 1. Goals
- G1 Find Markdown docs in a repo clone under configurable roots; list, search and preview them (read-only).
- G2 Attach docs to agents and to skills, per repo. Store only normalized repo-relative paths.
- G3 At review time, read the attached docs from the clone (deterministic, no extra LLM call) and pass them to reviewer-core as `specs`, rendered under `## Project context`, each inside an `<untrusted>` wrapper.
- G4 Make every limit deterministic and visible: per-doc status/reason/truncation/tokens and run-level counts in the trace. The persisted trace holds this metadata and a placeholder per doc, never the doc text (Q16=B).
- G5 Prove with hermetic tests (fake LLM) that the prompt carries an attached spec; prove once manually (paid, approval-gated) that a real reviewer applies it.

## 2. Non-goals
- Onboarding Generator; embeddings/RAG (`code_chunks` stays unused); editing docs (preview is strictly read-only); any extra LLM call to summarise or select docs; the CI runner; new MCP tools.
- **PR head context (v1 limitation):** docs are read from the default-branch working copy only. Docs added or changed by a PR are **not** used for that PR's review (AC-CTX-63, 64).
- **HW-05 PR Brief boundary:** the CTX limits and budget (§8) apply only to the `## Project context` section of review-agent prompts. They are not applied automatically to the HW-05 PR Brief, which defines its own budget, if any. This spec says nothing else about PR Brief behaviour (AC-CTX-67).
- **A1 non-goals:** the Evals, Stats and CI Agent-editor tabs shown in the A1 mockup; editing docs from the Agent editor; a Context tab on any other page; changes to the skill page Context tab; README discovery outside the configured roots (§17.2).
- **Trace persistence of other prompt parts is unchanged:** only Project Context doc text is replaced in the persisted trace (§6). Diff, skills, system prompt, PR description, intent, repo map, callers and `raw_output` are persisted exactly as today (AC-CTX-71). A model's `raw_output` that quotes a doc is not redacted (out of scope).

## 3. Actors and triggers
| Actor | Trigger | Effect |
|---|---|---|
| Studio user (workspace member) | Opens `/repos/[repoId]/context` | scan + list + search + read-only preview |
| Studio user | Edits the repo's discovery roots on the Context page | `settings` row saved |
| Studio user | Clicks "Re-index" | client refetches the list (new scan); no server-side index |
| Studio user | Attaches/detaches a doc to an agent (Context page) or a skill (skill page) | path row stored/removed |
| Studio user (A1) | Opens `/agents/[id]?tab=context`; toggles, reorders, previews docs | attachment rows stored/removed/re-ordered via the existing context-docs API (+ reorder, §17.4) |
| Studio user | `POST /pulls/:id/review` (existing) | `ReviewRunExecutor` resolves the attached docs |
| Server job `ReviewRunExecutor` | Each agent run, before the first LLM call | reads the files once, builds `specs[]`, replaces doc text with placeholders in the trace to persist, writes trace + log line |
| reviewer-core `assemblePrompt` | Each LLM call (per chunk in map-reduce) | renders `## Project context` (unchanged code) |
| MCP client | none new; `get_findings` shows results as today | — |

## 4. Current state (verified, path:line)
- No context module. Registry `server/src/modules/index.ts:27-39`; `:24` lists "brief/context/onboarding" as future work. No PR Brief module exists in `server/src/modules/` (grep "brief": only that comment and `settings/feature-models.ts:14`).
- `code_chunks` (`source` code|docs|spec, `embedding`) at `server/src/db/schema/context.ts:31-47` — not used for L05. No context-doc, root or attachment table exists.
- Analogous link `agent_skills` (agentId, skillId, order, enabled) at `server/src/db/schema/agents.ts:51-67`. Agents (`:8-36`) and skills (`server/src/db/schema/skills.ts:5-21`) are **workspace-scoped, not repo-scoped**; `repos` belongs to a workspace (`server/src/db/schema/repos.ts:5-25`).
- `settings` (workspaceId, nullable userId, key, jsonb value) at `server/src/db/schema/core.ts:34-48`, unique index on `(workspace_id, user_id, key)` (`:46`). With `user_id` NULL, Postgres treats NULLs as distinct, so this index does not prevent duplicate workspace-level rows — the upsert must handle that (§8).
- reviewer-core already supports specs: `PromptParts.specs?: string[]` (`reviewer-core/src/prompt.ts:177-178`); each entry → `wrapUntrusted('spec-<i>', s)` (`:234-237`) under `## Project context` in the **user** message (`:256`), after repo skeleton, before callers/diff. `assembly.specs` = the rendered block, and `assembly.user` = the full user message (`:271-281`). `wrapUntrusted` escapes `<untrusted`/`</untrusted` (`:40-50`) and is exported (`reviewer-core/src/index.ts:17`); `INJECTION_GUARD` always ends the system message (`:16-31`, `:227`). `ReviewInput.specs` at `reviewer-core/src/review/run.ts:60-61`, passed at `:140`; parts re-assembled per chunk in map-reduce (`:179`).
- The server never passes specs: `reviewPullRequest({...})` at `server/src/modules/reviews/run-executor.ts:290-317` has no `specs`. The trace spreads `outcome.assembly` into `prompt_assembly` (`:350-356`) and hard-codes `specs_read: []` (`:365`). The failure/cancel trace `traceFromBuffer` persists `specs: null`, `user: ''` (`:617`) and `specs_read: []` (`:621`), so it never carries prompt text.
- Skills: `effectiveSkills` + `planSkills` give the applied skills (ids, order, tokens) once per run (`run-executor.ts:281-284`; `server/src/modules/reviews/helpers.ts:31-45`), tokens via `container.tokenizer.count` (`server/src/platform/container.ts:128-131`).
- Trace contract (`server/src/vendor/shared/contracts/trace.ts`): `PromptAssembly.specs` string (`:56`), `RunTrace.specs_read: string[]` (`:109`), `skill_blocks` (`:41-49`, `:68`), `skills_tokens` (`:71`). No per-spec fields.
- Client: Trace drawer shows `specs_read` and the specs block (`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:52-57`, `:99-100`; strings `client/messages/en/runs.json:43,59`). Unused hooks `useContextFiles` (`GET /repos/:id/context`) and `useReindexContext` (`POST …/context/reindex`) at `client/src/lib/hooks/core.ts:122-137`; neither route exists. DTOs `SpecFile`/`IndexStatus` at `server/src/vendor/shared/contracts/platform.ts:302-317` (same lines in the client copy). `client/messages/en/context.json:1-24` has an empty state naming `.devdigest/specs/` (`:13`) and unused `editor.*` strings (`:19-23`). Sidebar maps `/context` (`client/src/components/app-shell/helpers.ts:30`) but no page exists. Agent editor has exactly two tabs (`client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:1-2`).
- Clones: `<cloneDir>/<owner>/<name>` (`server/src/adapters/git/simple-git.ts:37-39`), default `~/.devdigest/workspace` (`server/src/platform/config.ts:66-68`). `GitClient.readFile` uses a plain `join` (`simple-git.ts:129-131`). `sync` resets the worktree to `origin/<default branch>` (`:84-87`); the PR head is only the ref `pr-<n>` (`:72-75`).
- Safe-read precedent (`server/src/modules/conventions/samples.ts`): `unsafeRepoPath` rejects empty/over 500 chars, absolute, `\`, control chars, `..`/`.`/empty segments, sensitive paths (`:41-48`); `readCloneFile` rejects symlinks/non-regular files, checks realpath inside the clone, reads ≤ `maxBytes` cut at the last newline, rejects NUL/non-UTF-8, normalises CRLF (`:75-116`); `redactSecrets` (`:51-67`).
- Hermetic tests: `MockLLMProvider.calls` records requests (`server/src/adapters/mocks.ts:58-60,90`); route tests without a DB via `buildApp({ config, overrides })` + `inject` (`server/docs/testing.md:51-58`).

## 5. Inputs and provenance
| Input | Source | Trust | Validation / limits |
|---|---|---|---|
| Discovery roots | user (Context page) or defaults | trusted config, still validated | normalized (§9); `unsafeRepoPath` rules; ≤ 10 roots (L9) |
| Doc paths found | filesystem walk of the clone | untrusted (repo-controlled names) | `.md` only; no symlinks; skip list; limits L1–L3 |
| Doc contents | clone worktree at preview/search/run time | **untrusted** | UTF-8, no NUL; L4–L6; secret redaction (`redactSecrets`, Q17) |
| Search query `q` | user | untrusted | ≤ 200 chars (L8); case-insensitive substring |
| Attachment (agent or skill id, repo id, path) | user | user input | uuids scoped to the workspace; path normalized and must be a discovered doc; L7 |
| `repoId`, `agentId`, `skillId` | URL params | user input | `IdParams` uuid → 422; scoped by `workspaceId` from `getContext()` |

## 6. Outputs (contracts, UI, persistence, trace)
- **API (names final in the plan):** `GET /repos/:id/context?q=` → `{ files: SpecFile[] (path, size, updated_at; no content), roots: string[], truncated: boolean, truncated_reasons: ('file_limit'|'depth_limit'|'time_limit')[] }`; `GET /repos/:id/context/file?path=` → `SpecFile` with `content` + `truncated`; roots read/replace; attachment list/attach/detach for agent and for skill per repo, list items carry `status: 'ok'|'missing'|'outside_roots'`. **No** write/edit endpoint for documents; no `POST …/context/reindex`.
- **Persistence:** roots → one `settings` row per (workspace, repo) (workspace-level, `user_id` NULL); attachments → new table rows `(workspace, agent|skill, repo, normalized path, order)`. Only paths and metadata are persisted — never document content, in the DB rows **or** in `run_traces` (Q16=B).
- **Trace (jsonb, no migration; optional fields, both `vendor/shared` copies):**
  - `specs_read` = paths actually injected, in prompt order.
  - `prompt_assembly.spec_blocks[]`: `{ path, source: 'agent'|'skill', skill_id?, status: 'read'|'missing'|'skipped', reason?, tokens?, truncated? }`, one per attachment occurrence.
  - `prompt_assembly.specs_tokens`: tokens of `## Project context\n` + the specs block **as sent to the LLM** (full text), or null.
  - **Doc-text redaction before persisting (server executor only; reviewer-core unchanged, Q9=A):** the prompt sent to the LLM keeps the full text. After `reviewPullRequest` returns, the executor builds the trace to persist:
    - Placeholder per read doc *i* (one line, deterministic): `[project-context omitted from trace] path=<normalized path> tokens=<n> truncated=<true|false>`, where `n` = that entry's token count (= `spec_blocks[].tokens`).
    - Persisted `prompt_assembly.specs` = the placeholders, each passed through `wrapUntrusted('spec-<i>', …)` and joined by `\n\n` (same shape as the real block).
    - Persisted `prompt_assembly.user` = the real `user` with the first exact occurrence of `## Project context\n` + real `assembly.specs` replaced by `## Project context\n` + persisted `specs`. Everything else in `user` stays byte-identical.
    - Fail-closed: if that substring is not found, persisted `user` = `[user prompt omitted from trace: project context could not be isolated]`, and the run log gets a warning.
    - With no doc read, `specs`/`user` are persisted unchanged (null / today's text).
  - `prompt_assembly.spec_summary`: `{ attached, read, missing, skipped, truncated, tokens, limits: { doc_bytes, doc_tokens, prompt_tokens, attachments } }`.
  - Run-log line: `context: attached N doc(s) (T tokens), skipped M, truncated K`.
- **UI:** `/repos/[repoId]/context` page (roots editor, search, list, read-only Markdown preview, Re-index, attach-to-agent control with per-attachment status); skill page attach control; Trace drawer per-doc rows and summary; its existing specs prompt block (`TraceBody.tsx:99-100`) now shows the persisted placeholders, not doc text. Empty-state copy names the configured roots; unused `editor.*` strings are removed (Q6).

## 7. Functional requirements
- FR-1 Discovery under configured/default roots, filtering, limits → AC-CTX-01..07, 47..49
- FR-2 List, search, read-only preview, page, Re-index → AC-CTX-08..13, 39, 50..53
- FR-3 Attach/detach to agents and skills, normalization, dedup, limits → AC-CTX-14..18, 55..59
- FR-4 Paths-only persistence (DB rows and trace); read at prompt-assembly time → AC-CTX-19, 20, 61, 62, 69, 70..73, 75
- FR-5 Runtime injection, no extra LLM call, limits → AC-CTX-21..25, 41, 66, 74
- FR-6 Injection guard and FS boundaries → AC-CTX-26..32, 76
- FR-7 Trace visibility and token accounting → AC-CTX-33..37, 65
- FR-8 Degraded/missing/outside-roots/PR-head behaviour → AC-CTX-38, 40, 42, 43, 54, 60, 63, 64
- FR-9 Acceptance tests (hermetic + manual paid) → AC-CTX-44..46, 68
- FR-10 PR Brief boundary → AC-CTX-67
- FR-11 (A1) Agent editor Context tab: tab wiring, list/attach/detach/preview/count, reorder, persistence, order relation, Context page unchanged → AC-CTX-77..106

## 8. Constraints
**Limits (single source of truth; constants in the context module):**
| # | Limit | Value | Applies to | Overflow behaviour (deterministic) | Where reflected | AC |
|---|---|---|---|---|---|---|
| L1 | Files per discovery | 500 | list/search/attach validation | keep the first 500 in discovery order, drop the rest | list `truncated`, `truncated_reasons: file_limit` | 07 |
| L2 | Directory depth below a root | 8 | discovery | directories deeper than 8 levels are not entered | `truncated_reasons: depth_limit` | 47 |
| L3 | Discovery time | 2 s | discovery | stop walking, return what was collected so far (in order) | `truncated_reasons: time_limit` | 48 |
| L4 | Bytes per doc | 32 KB (32,768) | preview, search, injection | read ≤ 32 KB, cut at the last newline; a single over-long line → skipped `single line longer than the limit` | preview/trace `truncated: true`; skip reason in trace | 66, 74 |
| L5 | Tokens per doc | 4,000 | injection | drop whole trailing lines until entry + marker ≤ 4,000 tokens | trace `truncated: true`, `tokens` after cut | 24 |
| L6 | Project-context tokens per prompt | 12,000 | injection | include entries in order while the running sum ≤ 12,000; the first entry that does not fit and **all later ones** → `skipped`, `budget exhausted` (no skip-and-continue) | trace blocks + `spec_summary` | 41 |
| L7 | Attachments per agent per repo, per skill per repo | 10 each | attach; run time | attach #11 → 422, nothing stored; at run time rows beyond the first 10 by `order` → `skipped`, `attachment limit` | 422 body; trace | 18, 59 |
| L8 | Search query length | 200 chars | list | 422 | 422 body | 50 |
| L9 | Roots per repo | 10 | roots save | 422, nothing stored | 422 body | 49 |
- **Discovery order:** roots in configured order; inside a root, depth-first pre-order with directory entries sorted by UTF-16 code unit; a path found under two overlapping roots appears once (first occurrence).
- **Injection order:** the agent's attachments by `order`, then for each applied skill (in `planSkills` order) its attachments by `order`; dedup by normalized path keeps the first occurrence.
- **Per-doc entry:** `path: <p>\n\n<redacted, capped content>` (Q9=A); per-doc tokens = `container.tokenizer.count(entry)`; L5 and L6 use that figure. Map-reduce sends the same entries in every chunk (`run.ts:179`), so L6 bounds each prompt, not the run total.
- **Read time:** docs are read once per agent run, after the run starts and before the first LLM request; never at attach time; all chunks get identical entries.
- **Read source:** the default-branch worktree as left by the last `sync` (Q10=A). No `git show pr-<n>:…`, no sync at run time.
- reviewer-core stays pure and unchanged (no prompt order or guard change). Contract changes go into both `vendor/shared` copies in one change. Never write to the clone. Roots upsert must yield one row per (workspace, repo) despite the NULL-`user_id` unique index (`core.ts:41,46`).

## 9. Security
- Doc content goes only into the user message, each doc via `wrapUntrusted`; never the system message or `<skill>` framing; the existing guard covers every block.
- **Path normalization** (attach, roots, preview, run time): repo-relative; strip a leading `./`; collapse repeated `/`; drop `.` segments and a trailing `/`; then reject (422 at the API, `skipped` at run time) absolute paths, drive letters, any `..` segment, `\`, control chars, sensitive names (`unsafeRepoPath`). Backslashes are rejected, not converted. Comparison and dedup are **case-sensitive** after normalization (git paths are case-sensitive; Q17).
- Reads use `readCloneFile` semantics: regular files only, no symlinks (incl. symlinked directories in the walk), realpath inside the clone realpath, byte cap before reading, NUL/non-UTF-8 rejected.
- Workspace scoping on every query; agent/skill/repo of another workspace → 404; attachments never cross workspaces.
- Secrets redacted before preview, search results and injection (`redactSecrets`, Q17); keys/tokens never enter the trace.
- The persisted trace never contains Project Context doc text (§6, Q16=B); only the in-memory prompt sent to the LLM does.

## 10. Performance
- Discovery bounded by L1–L3; injection bounded by L4–L7; token counting via the existing tokenizer.
- 0 additional LLM calls (AC-CTX-22). No network I/O added to a run.

## 11. Error handling and failure modes
| Failure | Behaviour | AC |
|---|---|---|
| Attached file deleted/renamed | `status: missing`; run continues | 38 |
| Repo not cloned — list/preview | 409 `REPO_NOT_CLONED` | 39 |
| Repo not cloned — run | every attachment `skipped`, `repo not cloned`; no context section | 54 |
| Binary / non-UTF-8 / unreadable / symlink / outside clone | `skipped` with that reason | 29, 40 |
| Per-doc or per-prompt limit hit | truncate / skip per §8 table | 24, 41, 59, 66, 74 |
| Root folder absent | that root contributes nothing; 200 | 42 |
| Malformed path in API (absolute, `..`, `\`, control chars) | 422, no file read | 04, 76 |
| Well-formed path that is not a discovered doc | preview → 404; attach → 422 (request body rejected) | 11, 17 |
| Stored path unsafe at run time | `skipped` with reason, no read | 28, 29 |
| Project-context section cannot be isolated in `user` when persisting | persisted `user` replaced by the fail-closed placeholder; warning in the log | 73 |
| Attached path outside the current roots | run: `skipped`, `outside roots`; UI badge | 60, 43 |
| Doc only in the PR head / changed by the PR | default-branch version (or `missing`) is used | 63, 64 |
| (A1) Repo not cloned in the Agent Context tab | `notCloned` message, attachments still listed with status, no checkboxes | 94 |
| (A1) Reorder ids ≠ current set / foreign workspace | 422 / 404, nothing changed | 99, 100 |
| (A1) Reorder request fails in the UI | refetch server order, error shown | 97 |
| LLM/GitHub failure, cancel | unchanged; failure trace keeps `specs: null`, `user: ''`, `specs_read: []` (no doc text) | 75 |

## 12. Acceptance criteria (EARS)
| AC-ID | EARS statement | Verification |
|---|---|---|
| **Discovery & roots** | | |
| AC-CTX-01 | When the context list is requested, the server shall return every `.md` file found recursively under the repo's roots as normalized paths in discovery order (§8). | unit |
| AC-CTX-02 | While a repo has no roots row, the server shall use exactly `specs/`, `docs/` and `insights/`, each scanned recursively. | unit |
| AC-CTX-03 | When a user saves roots for a repo, the server shall store them in that repo's `settings` row and use them for the next list. | unit |
| AC-CTX-04 | If a root is empty, absolute, contains `..`, `\` or control chars, then the server shall answer 422 and keep the previous roots. | unit |
| AC-CTX-05 | The discovery walk shall skip non-`.md` files (incl. `.mdx`, `.markdown`), symlinks, `node_modules`, `dist` and every directory whose name starts with `.`. | unit |
| AC-CTX-06 | If a symlinked directory exists inside a root, then the discovery walk shall not follow it. | unit |
| AC-CTX-07 | If more than 500 docs exist, then the list shall contain the first 500 in discovery order, `truncated: true` and `file_limit` in `truncated_reasons`. | unit |
| AC-CTX-47 | If a directory lies more than 8 levels below a root, then the walk shall not enter it and the list shall report `depth_limit`. | unit |
| AC-CTX-48 | If the walk exceeds 2 s (injected clock), then the server shall stop, return the docs collected so far in order and report `time_limit`. | unit |
| AC-CTX-49 | If more than 10 roots are submitted, then the server shall answer 422 and store nothing. | unit |
| **List, search, preview** | | |
| AC-CTX-08 | The list endpoint shall return `path`, `size` and `updated_at` for each doc and no `content`. | unit |
| AC-CTX-09 | When `q` is given, the server shall return only docs whose path or (redacted, ≤ 32 KB) content contains `q`, case-insensitively. | unit |
| AC-CTX-50 | If `q` is longer than 200 chars, then the server shall answer 422. | unit |
| AC-CTX-10 | When a discovered doc is previewed, the server shall return its redacted content read from the clone, cut per L4, with `truncated`. | unit |
| AC-CTX-11 | If the preview path is not a discovered doc under the current roots, then the server shall answer 404 without reading the file. | unit |
| AC-CTX-39 | If the repo has no clone, then the list and preview endpoints shall answer 409 `REPO_NOT_CLONED`. | unit |
| AC-CTX-51 | The server shall expose no endpoint that creates, modifies or deletes a document file. | unit (route smoke) |
| AC-CTX-76 | If a preview or attach request carries a malformed path (absolute, drive letter, `..` segment, `\`, control chars), then the server shall answer 422 without reading any file. | unit |
| AC-CTX-12 | The `/repos/[repoId]/context` page shall render the roots, a search box, the list and a read-only Markdown preview of the selected doc. | unit (RTL) |
| AC-CTX-52 | The Context page preview shall render no editable control and no save action. | unit (RTL) |
| AC-CTX-53 | When the user clicks "Re-index", the page shall refetch the list via `GET` and send no other request. | unit (RTL) |
| AC-CTX-13 | While the list is empty, the page shall show the `context.empty` state naming the configured roots. | unit (RTL) |
| **Attachments** | | |
| AC-CTX-14 | When a user attaches a doc to an agent for a repo, the server shall store `(agent, repo, normalized path, order)` and return the updated list. | unit |
| AC-CTX-55 | When a user attaches a doc to a skill for a repo, the server shall store `(skill, repo, normalized path, order)` and return the updated list. | unit |
| AC-CTX-15 | When a user detaches a doc, the server shall remove that row only. | unit |
| AC-CTX-57 | When a path such as `./docs//a.md` is attached, the server shall store `docs/a.md`; `Docs/a.md` shall be treated as a different path. | unit |
| AC-CTX-58 | If the same normalized path is attached twice to the same agent (or skill) and repo, then the server shall keep one row. | unit |
| AC-CTX-17 | If the attached path is not a discovered doc of that repo, then the server shall answer 422 and store nothing. | unit |
| AC-CTX-18 | If an agent or a skill already has 10 attachments for the repo, then the server shall answer 422 for another one and store nothing. | unit |
| AC-CTX-16 | When an agent run applies a skill, the executor shall also inject the docs attached to that skill for the PR's repo, after the agent's own docs. | unit |
| AC-CTX-56 | If the same normalized path is attached to the agent and/or several applied skills, then the executor shall inject it once (first occurrence) and record later occurrences as `skipped`, `duplicate`. | unit |
| AC-CTX-59 | If more than 10 attachment rows exist for one agent (or skill) and repo at run time, then the executor shall use the first 10 by `order` and record the rest as `skipped`, `attachment limit`. | unit |
| **Persistence of paths; read time** | | |
| AC-CTX-69 | When an attachment is stored, the repository write shall contain only ids, the normalized path and order. | unit |
| AC-CTX-19 | After a review with an attached marker doc, the Postgres rows for roots, attachments and `run_traces` shall contain paths/metadata only and not the marker. | integration (approval) |
| AC-CTX-61 | When a doc is attached, the server shall not read the doc's content. | unit |
| AC-CTX-62 | When a run starts, the executor shall read each attached doc once, before the first LLM request, and pass identical entries to every chunk. | unit |
| AC-CTX-20 | When an attached file changes on disk between two runs, the second run's prompt shall contain the new content. | unit |
| AC-CTX-70 | When a run with a read doc containing a unique marker completes, `MockLLMProvider` shall have received the marker, and the trace passed to persistence (`finalizeDoneRun`) shall not contain the marker anywhere. | unit |
| AC-CTX-72 | When the trace is persisted, `prompt_assembly.specs` shall equal, per read doc *i* in prompt order, `wrapUntrusted('spec-<i>', '[project-context omitted from trace] path=<p> tokens=<n> truncated=<true\|false>')` joined by `\n\n`, and `user` shall contain the same block under `## Project context`. | unit |
| AC-CTX-71 | When the trace is persisted, `system`, `skills`, `skill_blocks`, `skills_tokens`, `raw_output` and every part of `user` outside the Project Context section (incl. the diff) shall be byte-identical to what was sent / returned. | unit |
| AC-CTX-73 | If the persisted Project Context section cannot be located in `user`, then the executor shall persist `user` as `[user prompt omitted from trace: project context could not be isolated]` and log a warning. | unit |
| AC-CTX-75 | If a run with attached docs fails or is cancelled, then the persisted failure trace shall contain no doc text (`specs: null`, `user: ''`, `specs_read: []`). | unit |
| **Runtime injection** | | |
| AC-CTX-21 | When a run starts for an agent with readable attached docs, the executor shall pass each as one `specs[]` entry in injection order (§8). | unit |
| AC-CTX-22 | The run shall make the same number of LLM calls with or without attached docs. | unit |
| AC-CTX-23 | While no doc is attached (or none is read), the assembled prompt shall equal the baseline prompt (no `## Project context`). | unit |
| AC-CTX-25 | Each `specs[]` entry shall start with the line `path: <normalized path>`. | unit |
| AC-CTX-66 | If a doc is larger than 32 KB, then the executor shall use the content up to the last newline within 32 KB and set `truncated: true`. | unit |
| AC-CTX-74 | If the first 32 KB of a doc contain no newline, then the executor shall skip it with reason `single line longer than the limit`. | unit |
| AC-CTX-24 | If an entry exceeds 4,000 tokens, then the executor shall drop whole trailing lines, append a truncation marker so the entry is ≤ 4,000 tokens, and set `truncated: true`. | unit |
| AC-CTX-41 | If adding the next entry would push the running total above 12,000 tokens, then the executor shall record it and all later entries as `skipped`, `budget exhausted`. | unit |
| **Injection guard & FS boundaries** | | |
| AC-CTX-26 | The assembled prompt shall place every doc only in the user message, inside `<untrusted source="spec-<i>">…</untrusted>` under `## Project context`. | unit (reviewer-core) |
| AC-CTX-27 | If a doc contains `</untrusted>` or `<untrusted …>`, then the prompt shall contain it escaped and each wrapper shall close once. | unit (reviewer-core) |
| AC-CTX-28 | If a stored path is absolute or contains `..` at run time, then the executor shall skip it with reason `absolute path` / `path traversal` without reading. | unit |
| AC-CTX-29 | If a stored path is a symlink or resolves outside the clone realpath, then the executor shall skip it without reading its content. | unit |
| AC-CTX-30 | If a request references an agent, skill or repo of another workspace, then the server shall answer 404. | integration (approval) |
| AC-CTX-31 | The server shall replace secret-looking values (`redactSecrets`) before preview, search matching and injection. | unit |
| AC-CTX-32 | If a path matches the sensitive-file rule (e.g. `.env`), then discovery, attach and injection shall all exclude it. | unit |
| **Trace & tokens** | | |
| AC-CTX-33 | When a run completes, the trace `specs_read` shall list the injected paths in prompt order. | unit |
| AC-CTX-34 | The trace shall record one `spec_blocks` entry per attachment occurrence with `path`, `source`, `skill_id` (skill source only), `status`, `reason` when not read, and `tokens` + `truncated` when read, and no doc content. | unit |
| AC-CTX-35 | The trace shall record `specs_tokens` = tokens of the `## Project context` section as sent to the LLM (full text), or null when absent. | unit |
| AC-CTX-65 | The trace shall record `spec_summary` with counts (attached, read, missing, skipped, truncated), total tokens and the L4–L7 values used. | unit |
| AC-CTX-36 | When the context step finishes (before the first LLM request), the run log shall contain one line `context: attached N doc(s) (T tokens), skipped M, truncated K` and no doc text. | unit |
| AC-CTX-37 | The Trace drawer shall show each `spec_blocks` row's path, status, reason, tokens and truncated mark, and the summary counts; its specs prompt block shall show the persisted placeholders. | unit (RTL) |
| **Degraded, missing, read source** | | |
| AC-CTX-38 | If an attached file is missing at run time, then the executor shall record `status: missing` and finish the review. | unit |
| AC-CTX-40 | If a doc is binary, non-UTF-8 or unreadable, then the executor shall skip it with that reason. | unit |
| AC-CTX-42 | If a root folder does not exist, then it shall contribute no docs and the list shall answer 200. | unit |
| AC-CTX-54 | If the clone is absent at run time, then the executor shall record every attachment as `skipped`, `repo not cloned`, and add no context section. | unit |
| AC-CTX-60 | If an attached path is not under any current root at run time, then the executor shall skip it with reason `outside roots`. | unit |
| AC-CTX-43 | While an attachment's status is `missing` or `outside_roots`, the UI shall show that status next to it. | unit (RTL) |
| AC-CTX-63 | When a PR's diff modifies an attached doc, the executor shall inject the worktree (default-branch) version, not the PR version. | unit |
| AC-CTX-64 | If an attached doc exists only in the PR head, then the executor shall record it as `missing`. | unit |
| **Acceptance tests (reviewer uses the spec)** | | |
| AC-CTX-44 | Given `specs: ['path: docs/spec.md\n\nRULE-CTX-7f3a: forbid console.log']`, `reviewPullRequest` with a fake provider shall send a user message containing the marker inside `<untrusted source="spec-0">` under `## Project context`, and the system message shall not contain it. | unit (reviewer-core) |
| AC-CTX-45 | Given a temp clone with `docs/spec.md` (marker) attached to an agent, a review with `MockLLMProvider` shall capture a request containing the marker, and the stored trace shall have `specs_read: ['docs/spec.md']`, `spec_blocks[0].tokens > 0` and no occurrence of the marker. | integration (approval) |
| AC-CTX-46 | While the hermetic e2e stack runs with the CTX fixtures (prerequisites P1–P3, §13 T7), a seeded e2e flow with no review run, no import and no LLM call shall: open the Context page of the seeded repo; see the effective roots, the `docs/spec.md` list entry and its read-only preview; attach it to a seeded agent and see it listed; and open the Trace drawer of the seeded run and see `docs/spec.md` in `specs_read`/`spec_blocks` and the placeholder line (AC-CTX-72 format), not the doc text. | e2e (approval) |
| AC-CTX-68 | When the test agent reviews an open PR with a real diff that violates a unique rule marker in an attached spec, at least one finding shall reference that rule. This makes a paid LLM call and shall not be run without separate explicit user approval. | manual (approval, paid) |
| **Boundary** | | |
| AC-CTX-67 | The L1–L9 constants shall be referenced only by the context module, its routes and the review executor's context step; no PR Brief code path shall import them. | manual (code review) |
| **A1 — Agent editor Context tab: wiring & tab state** | | |
| AC-CTX-77 | The Agent editor shall render exactly three tabs, in this order: Config, Skills, Context (no Evals/Stats/CI). | unit (RTL) |
| AC-CTX-78 | When `/agents/[id]?tab=context` is opened, the page shall show the Context tab as active; an unknown `?tab=` value shall still fall back to Config. | unit (RTL) |
| AC-CTX-79 | When the user clicks the Context tab, the page shall replace the URL with `?tab=context` (other query params kept). | unit (RTL) |
| AC-CTX-80 | While the Skills or the Context tab is shown, the Config tab shall stay mounted and hidden (no "Save agent" button visible), and edits made in Config shall still be present after Config → Context → Config. | unit (RTL) |
| AC-CTX-81 | If Config has unsaved edits and the user opens another agent while the Context tab is shown, then the UnsavedChangesModal shall appear, and after Discard the target URL shall keep `tab=context`. | unit (RTL) |
| **A1 — list, attach/detach, count, preview** | | |
| AC-CTX-82 | While the tab shows repo R, it shall list every doc of `GET /repos/R/context` (no `q`), each row with filename, folder path and a root badge = the longest root of `ContextList.roots` that prefixes the path. | unit (RTL) |
| AC-CTX-83 | The tab shall list the agent's attachments for R first, in the order returned by `GET /agents/:id/context-docs?repo_id=R`, with a checked checkbox, then the unattached discovered docs in discovery order, unchecked. | unit (RTL) |
| AC-CTX-84 | The header badge shall read "`<a>` of `<d>` attached", where a = number of attachment rows for (agent, R) and d = number of discovered docs. | unit (RTL) |
| AC-CTX-85 | When the user checks an unattached doc, the tab shall send exactly one `POST /agents/:id/context-docs?repo_id=R` with `{ path }` and then show it as attached at the end of the attached block. | unit (RTL) |
| AC-CTX-86 | When the user unchecks an attached doc, the tab shall send exactly one `DELETE /agents/:id/context-docs/:docId` for that row. | unit (RTL) |
| AC-CTX-87 | While the agent has 10 attachments for R, the unchecked checkboxes shall be disabled and the `attach.limit` message shown. | unit (RTL) |
| AC-CTX-88 | If an attachment has status `missing` or `outside_roots` (not in the discovered list), then the tab shall still show it in the attached block with `ContextDocStatus` and allow unchecking it. | unit (RTL) |
| AC-CTX-89 | When the user clicks a row's "Preview", the tab shall show the read-only `DocPreview` for that path in a side panel (`GET /repos/R/context/file?path=`), with no editable control and no save action. | unit (RTL) |
| AC-CTX-90 | When the user types in "Filter documents…", the tab shall show only rows whose path contains the text case-insensitively and shall send no request (Q23: A10). | unit (RTL) |
| AC-CTX-91 | The tab shall show the helper text about order and the footer stating the docs are injected as an untrusted `## Project context` block into review runs of this agent on PRs of this repo (Q23: A12). | unit (RTL) |
| **A1 — repo selection and degraded states** | | |
| AC-CTX-92 | When the tab opens, it shall show a repo picker listing the workspace repos with the active repo (`useActiveRepo().repoId`, else the first repo) selected; when the user picks another repo, the list and attachments shall switch to that repo (Q20). | unit (RTL) |
| AC-CTX-93 | If the workspace has no repo, then the tab shall show `context.tab.noRepo` and no list. | unit (RTL) |
| AC-CTX-94 | If `GET /repos/R/context` answers 409 `REPO_NOT_CLONED`, then the tab shall show `context.notCloned`, render no checkbox and still list existing attachments with their status. | unit (RTL) |
| **A1 — reorder (Q19)** | | |
| AC-CTX-95 | When the user moves an attached doc (drag-and-drop or ↑/↓ buttons), the tab shall send exactly one `PUT /agents/:id/context-docs/order?repo_id=R` whose `ids` are all attachment ids of (agent, R) in the new order. | unit (RTL) |
| AC-CTX-96 | While the filter is non-empty or a mutation is pending, the reorder controls shall be disabled. | unit (RTL) |
| AC-CTX-97 | If the reorder request fails, then the tab shall show the server order again (refetch) and an error message. | unit (RTL) |
| AC-CTX-98 | When `PUT /agents\|skills/:id/context-docs/order?repo_id=R` lists exactly the current attachment ids of (agent, R), the server shall store `order` = 1..n in that sequence and return the list in that order. | unit (route + in-memory store) |
| AC-CTX-99 | If the reorder ids are not exactly the current set (missing, extra, duplicate, unknown or another owner's id), then the server shall answer 422 and change nothing. | unit (route + in-memory store) |
| AC-CTX-100 | If the reorder request references an agent or repo of another workspace, then the server shall answer 404 and change nothing. | unit (route + in-memory store) |
| AC-CTX-101 | When two reorder/attach requests for the same (agent, R) run concurrently, the Postgres store shall serialize them under the existing advisory lock key `<workspace>:<owner>:<ownerId>:<repo>` and leave distinct, gap-free orders. | integration (approval) |
| **A1 — persistence, order relation, compatibility** | | |
| AC-CTX-102 | When the Agent editor is mounted again at `?tab=context` (page reload), the attached set and order shown shall equal the server's `GET …/context-docs` response; the tab keeps no client-only attachment state. | unit (RTL) |
| AC-CTX-103 | After a reorder of the agent's docs to [b, a], the next run's `specs[]` and `specs_read` shall contain b before a (relation to AC-CTX-21); the order shown in the tab equals the injected order of the agent's own read docs. | unit (executor / `buildProjectContext`, in-memory store) |
| AC-CTX-104 | When a doc is attached or detached on the Context page (`AgentAttachments`), the Agent editor Context tab for the same agent and repo shall show the change without reload (shared key `contextDocsKey`), and the existing Context page and skill Context tab tests shall pass unchanged. | unit (RTL) |
| AC-CTX-105 | The tab shall show each doc's size via `context.kb` and shall show no per-doc token count and no token total (Q21). | unit (RTL) |
| AC-CTX-106 | The A1 change shall add exactly one server endpoint, the reorder endpoint (Q19), no new contract field on `ContextListItem` or `ContextAttachment`, and shall otherwise reuse the hooks of `client/src/lib/hooks/context.ts`. | manual (code review) |

## 13. Test scenarios
- T1 reviewer-core unit, fake provider: marker spec, escaped wrapper text, two specs keep order → AC-CTX-26, 27, 44.
- T2 server unit, context helpers on a temp dir (injected clock): roots/defaults, walk order, skip list, symlinks, depth/file/time limits, normalization/case, traversal, `.env`, binary, CRLF, byte cap, missing root, search, redaction → AC-CTX-01, 02, 05..07, 09, 31, 32, 42, 47, 48, 57.
- T3 server unit routes (`buildApp` + overrides + in-memory repositories, no DB): roots save/422, list/preview/409/404/422, no write route, attach/detach/limits/dedup, no content read at attach, repository write shape → AC-CTX-03, 04, 08, 10, 11, 14, 15, 17, 18, 39, 49..51, 55, 58, 61, 69, 76.
- T4 executor unit, mocked repos/adapters + `MockLLMProvider` + temp clone: injection order, skills, dedup, call count, baseline equality, read-once, fresh content, caps, budget, run-time limits, trace fields, log line, missing/outside roots/no clone/PR-head; trace redaction (provider got the marker, persisted trace has placeholder + metadata and no marker, diff/skills unchanged, fail-closed, failure trace) → AC-CTX-16, 20..25, 28, 29, 33..36, 38, 40, 41, 54, 56, 59, 60, 62..66, 70..75.
- T5 client RTL: page, read-only preview, Re-index refetch, empty state, status badges, Trace drawer rows → AC-CTX-12, 13, 37, 43, 52, 53.
- T6 `.it.test.ts`, approval-gated (Docker): real persistence, workspace scoping, end-to-end marker → AC-CTX-19, 30, 45.
- T7 e2e, approval-gated, seeded data only → AC-CTX-46. Today the seeded repo has `clonePath: null` (`server/src/db/seed.ts:89`), the seed has no `agent_runs`/`run_traces` rows, the running API has no mock-LLM mode (`ContainerOverrides` are in-process only, `server/src/platform/container.ts:40-54`), and flows must not trigger reviews or imports (`e2e/CLAUDE.md:15-16,56-57`). So the flow needs these prerequisites:
  - P1 `scripts/e2e.sh` (or an equivalent setup step) creates a fixture clone directory containing `docs/spec.md` with a unique marker.
  - P2 The seed sets the seeded repo's `clonePath` to that directory.
  - P3 The seed inserts one `agent_runs` row plus its `run_traces` row whose trace carries `specs_read: ['docs/spec.md']`, a matching `spec_blocks` entry and the placeholder `specs` (no doc text).
  - The attach step is the flow's only write (an attachment row); the flow never clicks "Run review".
- T8 manual paid run, separate approval → AC-CTX-68. T9 code review → AC-CTX-67.
- T10 (A1) client RTL, hooks mocked like `AgentEditor.test.tsx:9-17`: tab list/order, `?tab=context` deep link + fallback, Config hidden-but-mounted, unsaved guard with `tab=context`, list/badge/count, check/uncheck requests, limit, missing rows, preview, filter, copy, repo selection, no repo, not cloned, reorder request/disabled/failure, remount shows server order, shared cache with the Context page → AC-CTX-77..97, 102, 104, 105.
- T11 (A1) server unit, `buildApp` + in-memory `ContextStore`: reorder happy path, set mismatch, workspace scoping, then `buildProjectContext` order after reorder → AC-CTX-98..100, 103. T12 (A1) `.it.test.ts`, approval-gated: concurrent reorder/attach on Postgres → AC-CTX-101. T13 code review → AC-CTX-106.

## 14. Assumptions (to be confirmed)
- A1 The scan reads the clone worktree directly; no DB index, no embeddings.
- A2 Attachments are keyed by `(agent|skill, repo, path)` because agents and skills are workspace-wide (`agents.ts:8-12`, `skills.ts:5-21`); an attachment applies only to PRs of that repo.
- A3 Attachment order = insertion order, kept in an `order` column like `agent_skills.order`.
- A6 Trace additions are optional fields, so old traces stay valid.
- (A4, A5, A7, A8 confirmed by the user → §15 Q17.)
- (A9–A15 of amendment A1 confirmed by the user → §15 Q23.) No open assumptions remain.

## 15. Decisions (user, 2026-10-18)
- Q1 Roots stored as a `settings` row per repo (no migration for roots).
- Q2 Defaults exactly `specs/`, `docs/`, `insights/`, recursive; `.md` only; skip `node_modules`, `dist`, `.git` and dot-directories.
- Q3 Attachments for agents and skills; a skill's docs are injected when the agent applies the skill; dedup by normalized path (§9).
- Q4 Limits as proposed; all in the §8 table with deterministic overflow and trace reflection.
- Q5 Case-insensitive substring search over path and content.
- Q6 Preview strictly read-only (no write endpoint, no edit UI); unused `editor.*` strings removed.
- Q7 Scan per list request; "Re-index" only refetches.
- Q8 Attach controls on the Context page (agents) and the skill page (skills); no third Agent-editor tab. — *Superseded by Q18 (amendment A1, 2026-10-18); kept as history.*
- Q9 Option A: first line `path: <p>` inside the existing wrapper; no reviewer-core change.
- Q10 Default-branch working copy; PR-head context not read (§2, AC-CTX-63, 64).
- Q11 Outside current roots → `skipped`, `outside roots`, visible in the trace.
- Q12 Uncloned repo → 409 `REPO_NOT_CLONED`.
- Q13 Hermetic unit tests wherever possible; integration/e2e only for real persistence and the end-to-end flow, approval-gated.
- Q14 Manual paid acceptance AC-CTX-68, separate approval.
- Q15 Lab 05 text unavailable; requirements limited to the Stage 2 request and these decisions.
- Q16 = B. Persisted `run_traces` never hold Project Context doc text. The executor (not reviewer-core) replaces it in `prompt_assembly.specs`/`user` with deterministic placeholders and persists per-doc metadata (path, source, skill_id, tokens, truncated, status/reason). The prompt sent to the LLM is unchanged. Trace persistence of diff, skills and other parts is unchanged (§2, §6, AC-CTX-70..73, 75).
- Q17 Confirmed former assumptions: A4 `redactSecrets` reused for preview, search and injection; A5 query ≤ 200 chars (L8); A7 ≤ 10 roots per repo (L9); A8 case-sensitive path comparison/dedup, backslashes rejected not converted. Also confirmed: duplicates traced as `skipped`, `duplicate` (AC-CTX-56); re-attach is idempotent (AC-CTX-58).
- Q18 (A1, user 2026-10-18) **Supersedes Q8.** The Agent editor gets a third tab, Context, next to Config and Skills (Config | Skills | Context). It lists the discovered docs of the selected repo and offers attach/detach, order, preview and the attached count, using the existing Project Context APIs. The Context page attach control (`AgentAttachments`) and the skill page Context tab stay as they are. The HW2 #35 "exactly two tabs" rule is replaced by "exactly Config, Skills, Context" (§17.6). Evals/Stats/CI stay out of scope.
- Q19 (A1, = Q-A1-1 option A) Reorder via a new `PUT /agents|skills/:id/context-docs/order?repo_id=` with body `{ ids: string[] }` and a new `ContextStore.reorderAttachments` method, run under the same advisory lock as `insertAttachment`. No migration; the request contract is added to both vendored `@devdigest/shared` copies (approval in §16).
- Q20 (A1, = Q-A1-2 option A) The tab has a repo picker that defaults to the active repo, like the skill ContextTab.
- Q21 (A1, = Q-A1-3 option A) No per-doc token counts and no token total in A1; rows show the size in kB. Possible follow-up (not a requirement): optional `tokens` on `ContextAttachment` for attached docs only (option B).
- Q22 (A1, = Q-A1-4 option A) No new e2e flow; A1 is verified by RTL/unit tests plus the approval-gated integration AC-CTX-101.
- Q23 (A1) Confirmed former assumptions:
  - A9 Attach, detach and reorder in the Context tab are saved immediately (one request per action, like the Skills tab); they are not part of the Config unsaved-edits guard.
  - A10 "Filter documents…" filters the loaded list client-side by path (case-insensitive); it does not call `?q=`.
  - A11 Root badge colours: fixed tokens for `specs`, `docs`, `insights`; any other root gets a neutral badge. A `readme` badge appears only if a configured root has that name; README discovery outside roots is a non-goal.
  - A12 Footer copy states the real scope: injected into review runs of this agent on PRs of this repo (narrower than the mockup's "every run").
  - A13 `DocPreview` moves from `client/src/app/repos/[repoId]/context/_components/DocPreview/` to the shared `client/src/components/context-doc-preview/` with unchanged behaviour; the Context page imports it from there.
  - A14 The reorder route is registered for both owner prefixes by the existing loop (`routes.ts:71-75`); only the agent UI uses it in A1.
  - A15 The reorder UI reuses the Skills tab pattern (drag-and-drop + ↑/↓, pure helpers like `SkillsTab/helpers.ts:84-104`); no new dependency.

## 16. Approvals required
- **Migration:** new attachment table(s) for agent/skill → repo-path rows (`server/src/db/schema/*` + `pnpm db:generate`). Roots need no migration (settings row).
- **Contract change** in both `vendor/shared` copies: list envelope (`truncated`, `truncated_reasons`, `roots`), preview `truncated`, attachment DTOs with `status`, trace `spec_blocks`, `specs_tokens`, `spec_summary`. Persisted `prompt_assembly.specs`/`user` keep their types but hold placeholders instead of doc text (Q16=B); old traces are not rewritten.
- **reviewer-core:** no source change (Q9=A, Q16=B redaction lives in the server executor); tests only.
- **Client:** new page, skill-page control, Trace drawer rows, `context.json` copy change and removal of `editor.*`; repoint/remove `useReindexContext`.
- **Integration tests** (Docker/testcontainers: AC-CTX-19, 30, 45) and the **e2e flow** (AC-CTX-46): explicit approval to run.
- **e2e fixtures for AC-CTX-46 (T7 P1–P3):** edits to `server/src/db/seed.ts` (repo `clonePath`, seeded `agent_runs` + `run_traces`) and to `scripts/e2e.sh` (or the equivalent setup, incl. `.github/workflows/e2e-web.yml` if CI must run the flow) each need explicit user approval (`e2e/CLAUDE.md:58-59`).
- **Paid LLM call:** AC-CTX-68 only, test agent + open PR with a real diff, separate explicit approval; never from automated tests.
- No new dependencies.
- **A1 — migration:** none. The `order` column exists and has no unique constraint (`server/src/db/schema/project-context.ts:26-31,48-53`), so a reorder is an UPDATE. No `server/src/db/schema/*` change.
- **A1 — APPROVAL REQUIRED (Q19):** new server endpoint `PUT /agents|skills/:id/context-docs/order?repo_id=`, `ContextService.reorder`, `ContextStore.reorderAttachments` and its `ContextRepository` implementation, plus a new request contract (`ContextReorderRequest { ids }`) in **both** `server/src/vendor/shared/contracts/platform.ts` and `client/src/vendor/shared/contracts/platform.ts`, in one change.
- **A1 — integration test:** AC-CTX-101 (`.it.test.ts`, Docker/testcontainers) needs explicit approval to run.
- **A1 — e2e:** no new flow (Q22); existing flows stay unchanged.
- **A1 — tab-count rule:** HW2 #35 changes from two to three tabs (comment and test edits, §17.6); the user confirms this by approving A1.
- **A1 — no paid LLM call, no new dependency, no reviewer-core change.**

## 17. Amendment A1 — Agent editor Context tab (Approved 2026-10-19)
### 17.1 Goals
- G-A1-1 From Agents → agent → Context, see the discovered docs of a repo, attach/detach them by checkbox, set their order, preview one, and see "`a` of `d` attached".
- G-A1-2 Reuse the existing context API, hooks and components; add exactly one backend capability, reorder (Q19).
- G-A1-3 Keep the Context page and skill-page flows, the `?tab=` behaviour and the Config unsaved-edits guard working unchanged.

### 17.2 Non-goals
- Evals / Stats / CI tabs; editing docs; changing discovery, limits, injection or trace behaviour (§1–§16 stay as approved); showing skill-attached docs in the agent tab; README discovery outside roots.

### 17.3 Current state (verified)
- Tabs: `TABS` = config, skills with the comment "exactly Config and Skills (HW2 #35)" (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:10-14`); `TAB_KEYS` derived (`:17`). Header comment `AgentEditor.tsx:1-5`. Config is hidden with `hidden={tab === "skills"}` (`AgentEditor.tsx:38`) — with a third tab this would leave Config **visible** under Context; it must become `tab !== "config"`.
- `?tab=` owned by the page: valid keys from `TAB_KEYS`, else `config` (`AgentEditorView.tsx:37`); `setTab` uses `router.replace` (`:38-42`); agent switch keeps the tab and is guarded (`:45-51`); failed save falls back to Config (`:59`).
- Tests pinning two tabs: `AgentEditor.test.tsx:55-60` ("has exactly two tabs: Config and Skills", expects `["Config","Skills"]`); `AgentEditorView.test.tsx:157-163` (edits survive Skills switch) — still valid. No e2e flow opens the Agent editor (`e2e/specs/03-agents.flow.json:4-9` checks the list only; flow 08 uses the Context page, `08-project-context.flow.json:8-22`). i18n `client/messages/en/agents.json:53-59` has `editor.tabs` config/skills/evals/stats/ci, no `context`.
- API (`server/src/modules/context/routes.ts`): `GET /repos/:id/context?q=` (`:53-60`), `GET …/context/file?path=` (`:62-69`), roots `GET|PUT` (`:35-51`), `GET|POST /agents|skills/:id/context-docs?repo_id=` (`:76-107`), `DELETE …/context-docs/:docId` (`:109-113`). **No endpoint changes the order of existing rows.** `insertAttachment` assigns `max(order)+1` under `pg_advisory_xact_lock(hashtext('<ws>:<owner>:<ownerId>:<repo>'))` (`repository.ts:126-146`); `ContextStore` has no reorder method (`types.ts:57-83`). List order: `order, created_at` (`repository.ts:122`); run order: rows sorted by `order` (`for-run.ts:110`).
- DTOs: `ContextListItem` = path, size, updated_at only — **no tokens, no root** (`server/src/vendor/shared/contracts/platform.ts:323-327`, same in the client copy); `ContextList.roots` exists (`:331-336`); `ContextAttachment` = id, repo_id, path, order, status (`:361-367`).
- Client: hooks `useContextList`, `useContextFile`, `useContextDocs`, `useAttachContextDoc`, `useDetachContextDoc`; shared key `contextDocsKey(kind, ownerId, repoId)` (`client/src/lib/hooks/context.ts:20-21,49-96`); no reorder hook. `ContextDocAttachments` = select + Attach + list with Detach, no order control (`client/src/components/context-doc-attachments/ContextDocAttachments.tsx:46-89`); `MAX_ATTACHMENTS = 10` (`constants.ts:2`). `ContextDocStatus` badge (`client/src/components/context-doc-status/ContextDocStatus.tsx:11-20`). `DocPreview({repoId, path})` read-only (`client/src/app/repos/[repoId]/context/_components/DocPreview/DocPreview.tsx:12-51`) is route-private. Skill `ContextTab` uses a repo picker defaulting to the active repo (`client/src/app/skills/[id]/_components/SkillDetailView/_components/ContextTab/ContextTab.tsx:17-35`). Active repo: URL > localStorage > first repo (`client/src/lib/repo-context.tsx:1-2,47-48`). Precedent for ordered replace: `PUT /agents/:id/skills` (`server/src/modules/agents/routes.ts:169-178`) and Skills tab drag/↑↓ helpers (`SkillsTab/helpers.ts:84-104`).

### 17.4 UI contract and API usage
- Tab key `context`, label `agents.editor.tabs.context` = "Context", inserted after `skills`. New component `AgentEditor/_components/ContextTab/` (`ContextTab.tsx`, `index.ts`, `helpers.ts` (row merge, root-of-path, move), `styles.ts`, `ContextTab.test.tsx`); rendered only while `tab === "context"`.
- Data: `useContextList(R, "")`, `useContextDocs("agents", agent.id, R)`, `useAttachContextDoc`, `useDetachContextDoc`, `useContextFile` via `DocPreview`; `useActiveRepo` for the picker's default R (Q20). New hook `useReorderContextDocs(kind, ownerId, repoId)` that invalidates `contextDocsKey` (Q19).
- Reorder endpoint (Q19): `PUT /agents|skills/:id/context-docs/order?repo_id=` body `ContextReorderRequest { ids: string[] }` (uuid, ≤ 10, unique) → 200 `ContextAttachment[]` in the new order; set mismatch → 422; owner or repo of another workspace → 404. Service: `requireOwner` + `repoOf` (existing), then `store.reorderAttachments(...)` in one transaction under the same advisory lock key as `insertAttachment`, writing `order` 1..n. No discovery walk, no file read.
- Layout (mockup): header "Project context" + badge; helper text; repo picker (Q20); filter box; rows (drag handle, ↑/↓, checkbox, filename, folder, root badge, size in kB (Q21), status badge for non-ok, Preview); right-hand `DocPreview` panel; footer without a token total. New strings in `client/messages/en/context.json` under a new `agentTab` key (existing keys unchanged).

### 17.5 Mockup comparison
| Mockup element | Status |
|---|---|
| Tabs Config \| Skills \| Context | needs client change (`constants.ts:11-14`, `AgentEditor.tsx:38-41`, `agents.json:53-59`) |
| Evals / Stats / CI tabs | out of scope (non-goal) |
| "Project context" header | string exists `context.json` `tab.title` (`:71`) |
| Badge "2 of 7 attached" | new client logic; data exists (`ContextList.files`, `GET …/context-docs`) |
| Helper "Order matters …" | new string; behaviour supported (injection by `order`, `for-run.ts:110`) |
| "Filter documents…" | new client component (Q23 A10); server `?q=` exists but searches content (`service.ts:94-110`) |
| Drag handle / reorder | **backend change (Q19)** — no order-changing endpoint today (`routes.ts:76-113`, `types.ts:57-83`); new `PUT …/context-docs/order` + store method + new client component |
| Checkbox toggle attach | new client component; API exists (POST/DELETE, `routes.ts:85-113`) |
| Filename + folder path | client split of `path` (`platform.ts:324`) |
| Root badge (specs/docs/insights/readme) | client-derived from `ContextList.roots` (`platform.ts:333`); no root field on items; `readme` per Q23 A11 |
| Per-doc tokens "559t" | **not in A1 (Q21)** — `ContextListItem` has no tokens (`platform.ts:323-327`); rows show size in kB (`context.json` `kb`, `:11`) |
| Footer "≈ 317 tokens" | **not in A1 (Q21)**; only the injection note is shown, copy per Q23 A12 |
| "Preview" + right-hand panel | `DocPreview` exists (`DocPreview.tsx:12-51`); moved to shared (Q23 A13) + new panel layout |
| Status of missing/outside-roots docs | `ContextDocStatus` exists (`ContextDocStatus.tsx:11-20`) |

### 17.6 Impact analysis — affected files
- **client (new):** `client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/*`; `client/src/components/context-doc-preview/*` (moved `DocPreview`, Q23 A13).
- **client (changed):** `AgentEditor/constants.ts` (add `context`; comment → "exactly Config, Skills and Context (HW2 #35 as amended by CTX A1)"); `AgentEditor.tsx` (header comment `:1-5`; `hidden={tab !== "config"}`; render ContextTab); `AgentEditor.test.tsx` (`:55-60` → expect `["Config","Skills","Context"]` and add Context to the probe list; mock `@/lib/hooks/context` and `@/lib/repo-context`); `AgentEditorView.tsx` (comment `:1-4` only); `AgentEditorView.test.tsx` (add hook mocks; new cases AC-CTX-78, 80, 81); `client/messages/en/agents.json` (`editor.tabs.context`); `client/messages/en/context.json` (`agentTab.*`); `client/src/app/repos/[repoId]/context/_components/ContextView/ContextView.tsx` + its test (import path of DocPreview only); `client/src/lib/hooks/context.ts` (new `useReorderContextDocs`, Q19).
- **server (Q19):** `server/src/modules/context/routes.ts` (reorder route in the owner loop), `service.ts` (`reorder`), `types.ts` (`ContextStore.reorderAttachments`), `repository.ts` (UPDATE under the advisory lock), test in-memory store(s) under `server/test/`, a new route unit test and a `.it.test.ts` for AC-CTX-101.
- **contracts (Q19, both copies, one change):** `ContextReorderRequest` in `server/src/vendor/shared/contracts/platform.ts` **and** `client/src/vendor/shared/contracts/platform.ts`; `ContextListItem` and `ContextAttachment` unchanged (Q21).
- **Unchanged:** `AgentAttachments`, `ContextDocAttachments`, skill `ContextTab`, `for-run.ts`, run executor, reviewer-core, migrations, seed, e2e flows (no flow pins two tabs; no new flow, Q22).
- **Risks:**
  - Config would show under Context if `hidden` (`AgentEditor.tsx:38`) is not changed to `tab !== "config"`.
  - Tests rendering `AgentEditor` / `AgentEditorView` crash without mocks for `@/lib/hooks/context` and `@/lib/repo-context`.
  - Reorder racing an attach/detach can send a stale id set; the server answers 422 (AC-CTX-99) and the UI refetches (AC-CTX-97).
  - The reorder must use the same lock key as `insertAttachment` (`repository.ts:138-140`), otherwise a concurrent attach can get a duplicate `order`; covered only by the approval-gated AC-CTX-101.
  - Client/server contract drift if only one vendored copy gets `ContextReorderRequest`.
  - Users may expect the mockup's token figures; A1 shows size only (Q21).

### 17.7 Resolved questions (A1)
- Q-A1-1 → option A (Q19). Q-A1-2 → option A (Q20). Q-A1-3 → option A (Q21; option B is a possible follow-up). Q-A1-4 → option A (Q22). Assumptions A9–A15 → confirmed (Q23). No open questions remain.
