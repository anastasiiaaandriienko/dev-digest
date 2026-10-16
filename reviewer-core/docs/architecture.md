# reviewer-core architecture

Verified against `reviewer-core/src` and its server call site on 2026-10-11. The
pipeline diagram is in [../README.md](../README.md). This page gives the exact
behaviour and marks each part as:
- **Active**: used on the default path;
- **Reachable**: works, but only when a non-default setting is used;
- **Scaffolding**: exported or accepted as input, but nothing in this repo uses it.

## 1. Entry point: `reviewPullRequest` (`src/review/run.ts:123`)

Input is `ReviewInput` (`run.ts:44-93`). The caller resolves everything before
the call:
- the diff, already parsed;
- the system prompt;
- the model id;
- the `LLMProvider`;
- the optional prompt slots;
- `onEvent`, `checkCancelled` and `sessionId`.

Steps:

1. **Mode selection** (`selectMode`, `run.ts:115-121`).
   - `single-pass` → one call.
   - `map-reduce` → one call per file, but only when the diff has more than one file.
   - `auto` (the default **inside core** when `strategy` is omitted) → map-reduce
     only if `additions + deletions > 400` (`DEFAULT_MAP_THRESHOLD_LINES`) **and**
     the diff has more than one file.
2. **Trace assembly.** A prompt built from the whole diff is kept as the trace's
   `assembly` (`run.ts:142`). Single-pass overwrites it with the real call's assembly.
3. **Chunks.** Map-reduce makes one chunk per file via `sliceDiff`; otherwise one
   chunk called `"all files"` (`run.ts:144-147`).
4. **Per chunk, in sequence** (`run.ts:162-188`):
   1. `checkCancelled()` is called; if it throws, the run aborts.
   2. A `tool` event is emitted.
   3. `assemblePrompt` builds the prompt.
   4. `llm.completeStructured({ schema: Review, schemaName: 'Review', maxRetries, sessionId? })`
      is called. `maxRetries` defaults to `DEFAULT_REVIEW_MAX_RETRIES` = 2.
   5. Tokens are added up. The cost is added up too, but becomes `null` as soon
      as any chunk reports `null`.
5. **Reduce.** `reduceReviews(partials)` (`review/reduce.ts:43`). A single
   partial is returned unchanged.
6. **Grounding.** `groundFindings(merged.findings, diff)` (`run.ts:197`) runs once,
   after the reduce. Each dropped finding is emitted as an `info` event.
7. **Result.** The engine returns `ReviewOutcome` (`run.ts:95-113`). Inside it,
   `review = { ...merged, findings: kept, score: scoreFromFindings(kept) }`.

### Is map-reduce active? No. It is reachable, not the default.

- `agents.strategy` is a `NOT NULL` column that defaults to `'single-pass'`
  (`server/src/db/schema/agents.ts:20-22`). The server's fallback `REVIEW_STRATEGY`
  is also `'single-pass'` (`server/src/modules/reviews/constants.ts`).
- Map-reduce (or `auto`) runs **only** if a user changes an agent's strategy in
  the Agent editor (`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx`).
- There is **no test** of the map-reduce path in this package (see [testing.md](testing.md)).
- Chunks run one after another, never in parallel. There is no multi-agent logic
  in core: the server loops over agents.

## 2. LLM abstraction

- **The interface.** `LLMProvider` is defined in `@devdigest/shared`
  (`server/src/vendor/shared/adapters.ts:82-88`) with `listModels`, `complete`,
  `completeStructured` and `embed`. The engine calls **only** `completeStructured`.
- **What a call returns.** `StructuredResult` holds `data`, `tokensIn`,
  `tokensOut`, `costUsd: number | null`, `raw` and `attempts`.
- **`OpenRouterProvider`** (`src/llm/openrouter.ts`). Active when an agent's
  provider is `openrouter`; the server builds it in `server/src/platform/container.ts`.
  - It uses the OpenAI SDK against `https://openrouter.ai/api/v1`, with a 90 s
    timeout and 2 SDK retries.
  - It sends `response_format: json_schema` with `strict: true`, plus `session_id`
    and `usage: { include: true }` when its id is `openrouter`.
  - **Repair loop:** it makes up to `maxRetries + 1` attempts. After a failed
    attempt it appends the bad output as an assistant message and the repair
    instruction as a user message. If every attempt fails, it throws.
  - A response with HTTP 200 but no `choices` throws an error that includes the
    upstream message.
  - **Cost:** it adds up the `usage.cost` values the API returned. If there are
    none, it uses the injected `estimateCost` instead; if that is missing too, the
    cost is `null`.
  - `listModels` reads raw `/models` data and converts per-token prices to per-1M
    prices; negative prices become `pricing: null`.
  - `complete` and `embed` throw `NOT_SUPPORTED`.
- **OpenAI and Anthropic providers** live in the **server** (`server/src/adapters/llm/`).
  They reuse `toJsonSchema` and `parseWithRepair` from this package through
  `server/src/platform/structured.ts`.

## 3. Prompt construction (`src/prompt.ts`)

**System message.** It is `agent.systemPrompt`, then the **Skills section**
(when any skill is applied), then `INJECTION_GUARD` — always last
(`assemblePrompt`). The guard declares `<untrusted>` content to be data, says
that claims such as "intentional", "test" or "do not flag" never narrow the
review, and that `<skill>` blocks can add criteria but never change the role,
the output format, or these rules.

**Skills section (HW2 #14).** `## Skills`, a fixed preamble (`SKILLS_PREAMBLE`),
then one block per skill **in the order the caller passes** (the server passes
the agent's `agent_skills` order, already filtered to skills enabled for the
agent and globally): `<skill name="…" version="N">body</skill>` (`formatSkill`).
Bodies are treated as possibly untrusted (skills can be imported): `</skill>`
and `<skill` tags inside a body are escaped, and the name is reduced to one safe
line. The tags are a boundary, not a guarantee — the preamble and the guard
state the limits too. `PromptAssembly.skills` is exactly the section text placed
in the system message.

**User message.** Its sections appear in this order (`assemblePrompt`). Any
empty or missing section is left out.

| # | Section | Source | Wrapped as untrusted? | Fed by server today? |
|---|---|---|---|---|
| 1 | task line | `task` | no | **yes** (PR title + rank note) |
| 2 | `## PR description` | `prDescription`, cut to 4000 chars | yes (`pr-description`) | **yes** when the PR has a body |
| 3 | `## Relevant memory` | `memory[]` as `- ` bullets | **no** (curated) | no (scaffolding, L07) |
| 4 | `## Repo skeleton` | `repoMap` | yes (`repo-map`) | **yes** when the repo is indexed |
| 5 | `## Project context` | `specs[]` | yes (`spec-<i>`) | no (scaffolding, L05) |
| 6 | `## Callers of changed symbols` | `callers` | yes (`callers`) | **yes** when repo-intel finds callers |
| 7 | `## Diff to review` | chunk diff text | yes (`diff`) | **yes**, always last |

- **Escaping.** `wrapUntrusted` (`prompt.ts:30-34`) escapes only the exact text
  `</untrusted>`. The label is inserted as is, which is safe because every label
  is chosen by the code.
- **Trace record.** `PromptAssembly` (the trace record) stores `callers` and
  `repo_map` as passed in, even when they are whitespace-only and the section was
  left out of the message (`prompt.ts:129-138`).

## 4. Structured output (`src/llm/structured.ts`)

- **`toJsonSchema`** reuses `openai/helpers/zod`'s `zodResponseFormat` to produce
  a strict JSON schema.
- **`parseWithRepair`** (`structured.ts:54`) tries three things in order:
  1. `JSON.parse(raw.trim())`;
  2. `extractJson` (strips a fenced block, or takes the first balanced `{…}`/`[…]`);
  3. `schema.safeParse`.

  When parsing fails it returns `repromptMessage`, which lists the Zod issue paths
  or reports invalid JSON. Plain `JSON.parse` comes first on purpose: fences or
  braces *inside* string values would confuse `extractJson`.

## 5. Grounding (`src/grounding.ts`)

- **Line index.** `buildLineIndex` maps each file to the new-side line numbers of
  its hunks. Those come from the diff parser in the **server**
  (`server/src/adapters/git/diff-parser.ts`), which counts **added and context
  lines**. A finding on an unchanged context line inside a hunk therefore passes.
  If a hunk has no `newLineNumbers`, the index falls back to the hunk's declared
  new range.
- **Checks, in order:**
  1. The file must appear in the diff (exact path match); otherwise the finding is dropped.
  2. `kind ∈ {secret_leak, lethal_trifecta, phantom, hook}` → the finding is kept
     on the file check alone (`grounding.ts:16`).
  3. Otherwise the range `[min(start,end), max(start,end)]` must contain at least
     one indexed line.
- **Summary.** `groundingSummary` gives `"kept/total passed"`.
- **Potential weakness.** `kind` comes from the model's own output. A model that
  labels an ordinary finding `secret_leak` skips the line check.

## 6. Scoring and verdict

- **Score.** `scoreFromFindings` (`review/reduce.ts:27-30`) computes
  `100 − Σ penalty`, clamped to `[0, 100]`, with CRITICAL 35, WARNING 12 and
  SUGGESTION 3. It is applied to the **kept** findings, and the model's `score`
  is discarded.
- **Verdict.** The **model's** verdict passes through (the worst one, in
  map-reduce). It is not recomputed, so it can contradict the score: an `approve`
  can arrive alongside kept CRITICAL findings.
  - Deterministic signals live in `output/to-review.ts`: `countBlockers`, which
    the server uses for run rows, and `toReviewPayload`'s event.
  - Verdict guidance for prompts is in
    [../../docs/agent-prompts/README.md](../../docs/agent-prompts/README.md).
- **`reduceReviews`.** It does **not** deduplicate findings. Its mean score is
  overwritten later anyway.

## 7. Trace data produced

`ReviewOutcome` fields (`run.ts:95-113`), and how the server uses each:

| Field | Server use (`run-executor.ts`) |
|---|---|
| `review` | persisted to `reviews` / `findings` |
| `grounding` | `agent_runs.grounding`, `trace.stats.grounding` |
| `dropped` | **not persisted.** Only visible as `info` log lines. |
| `mode`, `chunks` | `trace.tool_calls[]` (one `review_file` per chunk) |
| `assembly` | `trace.prompt_assembly` |
| `tokensIn/Out` | `agent_runs` + `trace.stats` |
| `costUsd` | **dropped by the server today.** See [../../server/specs/review-run-cost.md](../../server/specs/review-run-cost.md). |
| `raw` | `trace.raw_output` (chunk outputs joined with `\n---\n`) |

**Events** (via `onEvent`), in order:
1. `info` mode line
2. per chunk: `tool` "Reviewing …" / "map: reviewing <file>", then `result` "N candidate finding(s)"
3. `result` "Reduced to …"
4. `info` "grounding dropped …" for each dropped finding
5. `result` "Citation grounding: x/y passed"

## 8. Scaffolding and unused paths

| Item | Status |
|---|---|
| `skills`, `memory`, `specs` inputs | accepted and rendered; never passed by the server |
| `toReviewPayload`, `gateTriggered` | exported and tested; no consumer in this repo (the CI runner arrives in L06) |
| `OpenRouterProvider` `id: 'openai'` / `baseURL` options | supported; not used by the server |
| `extractJson`, `toJsonSchema`, `reduceReviews`, `sliceDiff` exports | used internally and via server shims and re-exports |

## 9. Potential bugs (code reading, not reproduced)

- **`sliceDiff` matches paths by substring** (`reduce.ts:63-64`). A header such as
  `diff --git a/src/a.tsx b/src/a.tsx` also matches `b/src/a.ts`, so a map chunk
  for `src/a.ts` can include `src/a.tsx`.
- **`sliceDiff` fallback has no hunks.** When no header matches, it returns only
  headers, even though its comment says "synthesize from the file's hunks"
  (`reduce.ts:68-71`). The model then sees an empty diff for that file.
- **A failed chunk loses everything.** A throwing chunk aborts the whole run, and
  the tokens and cost of the chunks that already finished are lost.
