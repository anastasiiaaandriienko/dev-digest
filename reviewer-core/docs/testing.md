# reviewer-core testing

Verified against `reviewer-core/vitest.config.ts`, `reviewer-core/test/*` and the
server tests that exercise core code (2026-10-11). Repo-wide CI lanes are described in
[../../TESTING.md](../../TESTING.md).

## Commands (inside `reviewer-core/`)

```sh
npm test              # vitest run --passWithNoTests
npm run typecheck     # tsc --noEmit (src/** only — test files are not type-checked by tsc)
```

**Prerequisites.**
- `reviewer-core/node_modules` must be installed: `zod`, `openai` and `vitest`
  resolve from there.
- `server/node_modules` must be installed too, because tests import server mocks.
- Installing anything requires user approval.
- The server's `server-unit` workflow also triggers on `reviewer-core/**` changes,
  so a core change is checked from both sides.

## Config

- **`vitest.config.ts`:**
  - `environment: 'node'`, `globals: true`;
  - includes `test/**/*.test.ts` and `src/**/*.test.ts` (the latter has no files today);
  - alias `@devdigest/shared` → `../server/src/vendor/shared`.
- **`tsconfig.json`:**
  - `include` is `src/**/*.ts` only, so **test files are type-checked by
    neither `npm run typecheck` nor vitest** (vitest strips types). A type error
    in a test file goes unnoticed.
  - It also pins `zod` to the local copy.

## Where tests live

| File | Covers |
|---|---|
| `test/run.test.ts` | `reviewPullRequest`: single-pass grounding drops a hallucinated finding; a clean approve scores 100; a throwing `checkCancelled` aborts before the LLM call; `sessionId` is forwarded |
| `test/prompt.test.ts` | `INJECTION_GUARD` appended; the "intentional/test/demo" clause; `## PR description` placement, omission and 4k cut |
| `test/to-review.test.ts` | `toReviewPayload` event per `failOn`; body header follows the computed event; `countBlockers`; inline-comment anchoring; `gateTriggered` |

**Core code that is tested only from the server.** These server tests import the
real core implementation, either through the server's re-export shims
(`server/src/platform/{grounding,prompt,structured}.ts`) or directly from
`@devdigest/reviewer-core` (`prompt-callers.test.ts`):

| Server test | Core code |
|---|---|
| `server/test/grounding.test.ts` | `groundFindings`, `groundingSummary`, line index |
| `server/test/prompt-structured.test.ts` | `wrapUntrusted`, section assembly, `toJsonSchema`, `extractJson`, `parseWithRepair` |
| `server/test/prompt-callers.test.ts` | `## Callers` placement, omission and escaping |

**Not covered anywhere:**
- the map-reduce path;
- `reduceReviews`;
- `sliceDiff`;
- `scoreFromFindings` penalties beyond the "0 findings ⇒ 100" case;
- null-cost propagation;
- `OpenRouterProvider` (no HTTP is mocked).

## Mocking the LLM

1. **`MockLLMProvider`** from `../../server/src/adapters/mocks.js`:

   ```ts
   const llm = new MockLLMProvider('openai', { structured: fixture });
   ```

   - It validates `fixture` against the requested schema and **throws** when it
     doesn't match, so fixtures must be valid `Review` objects.
   - It always reports `tokensIn: 100`, `tokensOut: 50` and `costUsd: 0.001`.
   - It records each request in `llm.calls`.
   - Its `id` can only be `'openai'` or `'anthropic'`.
2. **An inline `LLMProvider` object.** Use this when you need control over every
   call: recording requests, a different cost or token count, or failing on the
   n-th call. See the recorder in `run.test.ts:107-132`. Implement all four
   methods; the ones you don't need can throw.
3. **The diff.** `await new MockGitClient().diff()` returns a parsed diff of
   `src/config.ts`, built by the real `parseUnifiedDiff`. Line 11 is inside a hunk
   and line 999 is not. For any other shape, parse a raw string with
   `parseUnifiedDiff` from `server/src/adapters/git/diff-parser.ts`.

## Fixture rules

- Every `Finding` needs `id`, `severity` (`CRITICAL|WARNING|SUGGESTION`),
  `category`, `title`, `file`, `start_line`, `end_line`, `rationale` and
  `confidence` (0–1).
- The `Review` itself needs `verdict`, `summary`, `score` (an integer from 0 to
  100) and `findings`.
- When testing grounding, set `file` to a path that exists in the diff and pick
  lines from the parsed hunks. Context lines count as covered.

## Edge cases worth a test when you touch the code

| Area | Case |
|---|---|
| Mode | `auto` with exactly 400 changed lines (stays single-pass) vs 401 and several files; `map-reduce` with 1 file (falls back to single-pass) |
| Map-reduce | one chunk per file; worst verdict wins; findings concatenated; a chunk with `null` cost makes the total `null` |
| Grounding | file missing from the diff; reversed range (`start > end`); range spanning a gap between hunks; full-file kinds; a context line inside a hunk |
| Score | a mix of severities; clamping to 0 |
| Prompt | untrusted text containing `</untrusted>`; whitespace-only `repoMap`/`callers`; section order with every slot filled |
| Cancellation | `checkCancelled` throwing before the 2nd chunk in map-reduce |
| Structured | JSON inside a fence; braces inside string values; schema mismatch produces a reprompt that lists the issue paths |

Proposed test work is tracked in [../specs/review-pipeline.md](../specs/review-pipeline.md).
