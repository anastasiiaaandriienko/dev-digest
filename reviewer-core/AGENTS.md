# AGENTS.md — reviewer-core (`@devdigest/reviewer-core`)

Package-level guide. The root [`../AGENTS.md`](../AGENTS.md) (repo layout, naming,
global "do not touch" rules) still applies; this file adds only what is specific
to the review engine. Details live in the linked docs — open them only when needed.

## What this package is

- The **pure review engine**: unified diff + agent inputs + injected `LLMProvider`
  → grounded `Review` (+ trace data: prompt assembly, tokens, cost, raw output).
- **No DB, GitHub, filesystem, env or secrets.** The only side effect is the
  injected provider's network call. Keep it that way — I/O belongs in the caller.
- **Never built or published.** The server imports `../reviewer-core/src` as raw TS
  through a path alias; `npm run build` is just a typecheck. `.gitignore` blocks
  stray `src/**/*.js` that would shadow the sources.
- **Only consumer today:** the server (`server/src/modules/reviews/run-executor.ts`
  calls `reviewPullRequest`; `server/src/platform/{grounding,prompt,structured}.ts`
  are re-export shims). The CI runner mentioned in comments is not in this repo.

## Source map (`src/`)

| File | Role |
|---|---|
| `index.ts` | the public API — everything consumers may import |
| `review/run.ts` | `reviewPullRequest`: mode → prompt → LLM per chunk → reduce → ground → score |
| `prompt.ts` | `assemblePrompt`, `wrapUntrusted`, the `INJECTION_GUARD` |
| `llm/structured.ts` | Zod → JSON Schema, `extractJson`, `parseWithRepair` |
| `llm/openrouter.ts` | `OpenRouterProvider` (structured calls only; injected cost estimator) |
| `grounding.ts` | citation gate: findings must hit a diff line (or file, for full-file kinds) |
| `review/reduce.ts` | `reduceReviews`, `sliceDiff`, `scoreFromFindings` (not exported) |
| `output/to-review.ts` | GitHub review payload + `countBlockers` / `gateTriggered` |

## Commands (inside `reviewer-core/`, npm — not pnpm)

```sh
npm run typecheck   # tsc --noEmit (also what `npm run build` does)
npm test            # vitest run --passWithNoTests
```

Tests import the server's mocks, so `server/` must type-check and both packages
need their `node_modules` — installing anything needs user approval.

## Invariants that must not break

- Every untrusted string (diff, PR body, repo map, callers, specs) goes through
  `wrapUntrusted`; `INJECTION_GUARD` is always appended to the system prompt.
- Grounding runs once, after reduce, on every path; `review.score` is always
  `scoreFromFindings(kept)` — never the model's number.
- `costUsd` is `null` (never 0) if any chunk's cost is unknown.
- No new runtime dependency or I/O; contracts come from `@devdigest/shared`.

## Boundaries

- `@devdigest/shared` resolves to **`../server/src/vendor/shared`** — editing a
  contract changes the server too, and the client copy must be updated by hand.
- `zod` is pinned to `./node_modules/zod` (tsconfig `paths`) to avoid two zod copies.
- Use npm here; leave `package-lock.json` and the stray untracked `pnpm-lock.yaml`
  / `pnpm-workspace.yaml` untouched.
- Changing prompt section order, guard text or score weights changes every
  review's output — call it out explicitly in the change.

## Read When

- **Changing the pipeline, prompt, structured output, grounding, scoring or trace
  fields** → [docs/architecture.md](docs/architecture.md)
- **Writing or running tests, building fixtures, mocking the LLM** →
  [docs/testing.md](docs/testing.md), then [../TESTING.md](../TESTING.md) for CI lanes
- **Checking what behaviour is guaranteed vs proposed, or adding acceptance tests** →
  [specs/review-pipeline.md](specs/review-pipeline.md)
- **Editing agent system prompts or verdict/score guidance** →
  [../docs/agent-prompts/README.md](../docs/agent-prompts/README.md)
- **How the server calls the engine, persists results and streams events** →
  [../server/docs/architecture.md](../server/docs/architecture.md)
- **Cost flow from provider to UI (L01)** →
  [../server/specs/review-run-cost.md](../server/specs/review-run-cost.md)
- **Known cross-package pitfalls (contract drift, cancel checkpoint)** →
  [../server/INSIGHTS.md](../server/INSIGHTS.md)
- **High-level overview and diagram** → [README.md](README.md)
- **Repo-wide rules** → [../AGENTS.md](../AGENTS.md)
