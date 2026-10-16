# AGENTS.md — server (`@devdigest/api`)

Package-level guide. The root [`../AGENTS.md`](../AGENTS.md) (repo layout, naming,
global "do not touch" rules) still applies; this file only adds what is specific
to `server/`. Details live in the linked docs — open them only when the task needs them.

## Architecture in one screen

- **Entry:** `src/server.ts` → `buildApp()` (`src/app.ts`). Order matters: zod
  compilers → `Container` decorated on the app → boot-time reaper of stale
  `running` runs → helmet / cors / SSE / rate-limit → error handler → modules.
- **DI:** `src/platform/container.ts` is the composition root. Adapters (LLM,
  GitHub, git, code index, repo-intel, tokenizer, depgraph) are lazy and
  overridable via `ContainerOverrides`; the `RunBus` is a process-wide singleton.
- **Modules:** `src/modules/<name>/routes.ts` default-exports a Fastify plugin,
  registered statically in `src/modules/index.ts` (no autoload).
- **Review engine:** `@devdigest/reviewer-core` is imported as raw TS from
  `../reviewer-core/src`. The server owns I/O only (diff, repo-intel context,
  persistence, SSE); prompt → LLM → grounding → score happens in core.
- **Reviews are fire-and-forget:** `POST /pulls/:id/review` creates `agent_runs`
  rows and returns run ids; `ReviewRunExecutor` runs in the background; progress
  streams over SSE; the full log is saved once into `run_traces`.
- **Contracts:** `src/vendor/shared` (`@devdigest/shared`) is the server copy;
  reviewer-core uses it too. The client copy is separate and behind.

## Commands (run inside `server/`)

```sh
pnpm dev                                              # tsx watch, API on :3001
pnpm typecheck                                        # tsc --noEmit
pnpm exec vitest run --exclude '**/*.it.test.ts'      # unit, no Docker
pnpm exec vitest run .it.test                         # integration (testcontainers)
pnpm test                                             # both
```

`pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate` and any install need explicit
user approval (root AGENTS.md). Migrations are not applied on boot.

## Conventions that bite

- Relative imports end in `.js` (ESM); single quotes; kebab-case files.
- Scope every query by `workspaceId` from `getContext()` (`src/modules/_shared/context.ts`).
- Validate `:id` with `IdParams` (uuid) → invalid ids become 422, not 500.
- Throw `AppError` subclasses (`src/platform/errors.ts`); the handler in `src/app.ts`
  maps them to `{ error: { code, message, details } }`.
- Route run-event output through `RunLogger` (`src/platform/run-logger.ts`), not
  `runBus.publish` directly, so the Live Log and the persisted trace agree.
- repo-intel is read through `container.repoIntel` only; it degrades, never throws.
- A test that touches Postgres **must** be named `*.it.test.ts`.

## Safety boundaries

- Never edit `src/db/migrations/**`; a `src/db/schema/*.ts` change implies a new
  migration → ask first.
- Never touch lockfiles or `package.json` deps; `package.json` is `skip-worktree` locally.
- Changing a contract in `src/vendor/shared` → update `client/src/vendor/shared` too (or ask).
- `server/clones/**` is runtime data. Secrets live in `~/.devdigest/secrets.json`, never in git/DB.
- `INSIGHTS.md` is append-only and owned by the `engineering-insights` skill.

## Read When

- **Changing the review flow, SSE, run status, traces or restart behaviour** →
  [docs/architecture.md](docs/architecture.md)
- **Adding or changing a module, route, service or repository** →
  [docs/modules.md](docs/modules.md)
- **Writing or running tests, choosing unit vs integration, mocking adapters** →
  [docs/testing.md](docs/testing.md), then [../TESTING.md](../TESTING.md) for CI lanes
- **Using repo map, file rank, callers, blast radius, conventions or phantom refs** →
  [docs/repo-intel.md](docs/repo-intel.md) and
  [src/modules/repo-intel/README.md](src/modules/repo-intel/README.md)
- **Working on L01 run cost (PR list, run timeline, Trace drawer)** →
  [specs/review-run-cost.md](specs/review-run-cost.md)
- **Before non-trivial server work, or when something looks wrong** →
  [INSIGHTS.md](INSIGHTS.md) (verified pitfalls: contract drift, restart reaper, cancel race)
- **Env vars, API map, prompt-injection and grounding rationale** →
  [README.md](README.md)
- **Repo-wide rules, other packages** → [../AGENTS.md](../AGENTS.md)
