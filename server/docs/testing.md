# Server testing

Verified against `server/vitest.config.ts`, `server/test/**` and
`server/src/adapters/mocks.ts` on 2026-10-11. CI lanes and the testing philosophy
for the whole repo are in [../../TESTING.md](../../TESTING.md); this page covers
only what you need when writing server tests.

## Layout and config

- **Where tests live.** Tests go in `server/test/`. Vitest also picks up
  `src/**/*.test.ts`, but no such files exist today.
- **Config** (`vitest.config.ts`):
  - environment `node`, `globals: true`;
  - `testTimeout` and `hookTimeout` are 120 s, because testcontainers is slow to start;
  - aliases: `@devdigest/shared` → `src/vendor/shared` and
    `@devdigest/reviewer-core` → `../reviewer-core/src`.
- **Dependencies.** reviewer-core must have its own `node_modules` installed,
  because its zod alias resolves there.

## Two lanes, split by filename

| Lane | Files | Needs | Command |
|---|---|---|---|
| unit | everything except `*.it.test.ts` | nothing (no DB, keys or network) | `pnpm exec vitest run --exclude '**/*.it.test.ts'` |
| integration | `*.it.test.ts` | Docker daemon | `pnpm exec vitest run .it.test` |
| both | — | — | `pnpm test` |

Also run `pnpm typecheck`. There is no lint step.

**Rule:** any test that imports `test/helpers/pg.ts` or touches Postgres must be
named `*.it.test.ts`, otherwise the unit lane breaks.

## Integration tests (`*.it.test.ts`)

- **Docker gate.** `test/helpers/pg.ts`:
  - `dockerAvailable()` runs `docker info` and caches the result;
  - each suite uses `const d = hasDocker ? describe : describe.skip` (see
    `test/reviews.it.test.ts:12-13`).
  - Without Docker these suites are **skipped silently**, so a "green" run proves nothing about them.
- **Database.** `startPg()` starts `pgvector/pgvector:pg16`, runs all migrations
  via `runMigrations(url)` and returns a Drizzle handle plus `stop()`. Seed the data
  you need inside the test.
- **App.** Build it with `buildApp({ config, db, overrides })` and drive it with
  `app.inject(...)`. No port is opened.
- **Waiting for reviews.** `POST /pulls/:id/review` returns before the review
  finishes. Call `waitForPrRuns(db, prId, { expected })` (`test/helpers/runs.ts`)
  before you assert on reviews, findings, `agent_runs` or `run_traces`.
- **Fixture example.** `test/reviews.it.test.ts` uses a small diff and a review
  fixture that includes a finding which grounding must drop.

## Unit tests

- **Route smoke.** `test/routes-smoke.test.ts` calls `buildApp({ config, overrides })`
  without a DB and uses `inject`.
- **Pure logic.** Some tests import a module and call it directly, for example
  `price-book.test.ts` (clock and lister injected) and `grounding.test.ts`.
- **repo-intel.** Facade tests inject a mock through `ContainerOverrides.repoIntel`,
  or an in-memory repository (see [repo-intel.md](repo-intel.md#tests)).

## Mocks (`src/adapters/mocks.ts`)

| Mock | Use |
|---|---|
| `MockLLMProvider(id, { structured, structuredBySchema, completionText, embedding, models })` | Checks the fixture against the request schema (throws if it does not match). Records `calls`. Always reports `tokensIn: 100`, `tokensOut: 50`, `costUsd: 0.001`. `id` can only be `'openai'` or `'anthropic'`. |
| `MockGitHubClient`, `MockGitClient`, `MockCodeIndex` | No network or clone. `MockGitClient` returns a diff parsed with the real `parseUnifiedDiff`. |
| `MockEmbedder`, `MockAuthProvider`, `MockSecretsProvider` | key-free auth, secrets and embeddings |

Inject mocks with `ContainerOverrides` (`src/platform/container.ts:40-54`):
`secrets`, `auth`, `github`, `git`, `codeIndex`, `embedder`,
`llm: { openai | anthropic | openrouter }`, `repoIntel`, `depgraph`, `tokenizer`.
`priceBook`, `agentsRepo` and `reviewRepo` **cannot** be overridden.

## Gotchas

- **Shared `RunBus`.** It is a module-level singleton, so it is shared across apps
  in the same test file. Use fresh run ids and don't assume an empty bus.
- **Rate limiting.** It is off under `NODE_ENV=test` (the global limit is not
  registered). Per-route `rateLimit` configs then have no effect.
- **Failed runs.** They store `tokens = 0` (see [architecture.md](architecture.md#3-review-execution-flow)),
  so assert on that rather than on mock usage.
- **reviewer-core tests** reuse these server mocks, so a broken server type also breaks `reviewer-core` tests.
- **`server/package.json`** is `skip-worktree` locally. Use the `pnpm exec vitest …`
  forms above rather than scripts that may not exist in the committed file.
