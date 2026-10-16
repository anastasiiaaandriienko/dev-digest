---
name: onion-architecture
description: The intended dependency direction of the DevDigest backend (server/) — route → service → domain/repository, with every external integration (LLM, GitHub, git, secrets, tokenizer, repo-intel) behind an adapter interface and obtained through the DI Container; dependencies point inward and routes never call adapters directly. Includes how routes get services, how dependencies are injected and overridden in tests, good/bad examples, and the list of existing violations. Use when adding or changing a server module, route, service, repository or adapter, or when reviewing server changes for layering.
metadata:
  type: instruction
  scope: server
---

# Onion architecture (server/)

The layering every new or changed server module must follow. It describes the **target**
design; the current code does not fully meet it yet (see "Known violations"). Package rules:
[server/AGENTS.md](../../../server/AGENTS.md); module layout details:
[server/docs/modules.md](../../../server/docs/modules.md).

Not covered here: Fastify API details → `fastify-best-practices`; queries, schema and
transactions → `drizzle-orm-patterns`; table design → `postgresql-table-design`.

## The layers (outside → inside)

```
HTTP  ─►  routes.ts        transport only: parse/validate, getContext, call ONE service method, map result
          │
          ▼
          service.ts       use-cases: orchestration, authorization by workspace, AppError on failure
          │        \
          ▼         ▼
   repository.ts   domain (pure)          ports (interfaces)
   *.repo.ts       helpers.ts, status.ts,  server/src/vendor/shared/adapters.ts
   (Drizzle)       cost.ts, reviewer-core  LLMProvider, GitHubClient, GitClient, Embedder, …
                                                 ▲
                                                 │ implemented by
                          server/src/adapters/*  (octokit, simple-git, openai/anthropic, tokenizer, …)
                          wired in server/src/platform/container.ts
```

Dependency rule: **arrows point inward only.**

- The domain imports nothing from Fastify, Drizzle or adapters. Domain code = pure module
  helpers (`pulls/status.ts` `deriveReviewStatus`, `pulls/cost.ts` `toPrCost`) and the
  review engine in `reviewer-core` (prompt → LLM port → reduce → grounding; it never
  touches the DB, GitHub or the filesystem).
- Services depend on **ports** (interfaces from `@devdigest/shared` adapters) and
  repositories, never on concrete adapter classes.
- Adapters live at the edge (`server/src/adapters/<name>/`) and implement a port. Only
  `platform/container.ts` constructs them.
- Routes depend on services only.

## How routes obtain services

Each module is a Fastify plugin in `modules/<name>/routes.ts` (default export), registered
statically in `src/modules/index.ts`. The plugin builds its service once from the
container decorated on the app:

```ts
// server/src/modules/agents/routes.ts:72
const service = new AgentsService(app.container);
```

The service pulls what it needs from the container in its constructor:

```ts
// server/src/modules/agents/service.ts:51-56
export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }
}
```

## How dependencies are injected

- `Container` (`server/src/platform/container.ts`) is the composition root. Adapters are
  **lazy** getters / async factories: `container.git`, `container.tokenizer`,
  `container.repoIntel`, `await container.github()`, `await container.llm(provider)`.
  `container.db`, `secrets`, `auth`, `jobs` and the process-wide `runBus` are fields.
- Tests swap any adapter through `ContainerOverrides`:

```ts
buildApp({
  config, db: pg.handle.db,
  overrides: {
    secrets: new MockSecretsProvider({}),
    github: new MockGitHubClient({ pulls: [] }),
    llm: { openai: new MockLLMProvider('openai', { structured: FIXTURE }) },
  },
});
```

  Mocks live in `server/src/adapters/mocks.ts`. Because everything outside the domain is
  reached through the container, a service is testable without network, keys or GitHub.
- repo-intel is read only through `container.repoIntel`; it degrades, never throws.

## Good / bad

**Good — route delegates, service orchestrates through ports**

```ts
// routes.ts
app.post('/repos/:id/poll', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.pollRepo(workspaceId, req.params.id);
});

// service.ts
async pollRepo(workspaceId: string, repoId: string) {
  const repo = await this.repos.getById(workspaceId, repoId);
  if (!repo) throw new NotFoundError('Repo not found');
  const gh = await this.container.github();          // port: GitHubClient
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  return this.pulls.upsertMany(workspaceId, repo.id, pulls); // repository
}
```

**Bad — route talks to the adapter and the DB itself**

```ts
// routes.ts  ✗ adapter + Drizzle inside the transport layer
app.post('/repos/:id/poll', async (req) => {
  const [repo] = await container.db.select().from(t.repos).where(/* … */);
  const gh = await container.github();
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  for (const pr of pulls) await container.db.insert(t.pullRequests).values(/* … */);
});
```

**Bad — inner layer reaching outward**

```ts
// helpers.ts / reviewer-core  ✗ domain importing an adapter or the DB
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import * as t from '../../db/schema.js';
```

**Bad — constructing an adapter outside the container**

```ts
// service.ts  ✗ bypasses ContainerOverrides, so tests hit the real API
const llm = new OpenAIProvider(apiKey);
```

## Rules for new or changed code

1. A route handler: validate (`IdParams` etc.), `getContext`, one service call, return.
   No `container.db`, `container.github()`, `container.llm()`, `container.git` in `routes.ts`.
2. Business rules and orchestration in `service.ts` (`XService`); DB access in
   `repository.ts` (`XRepository`) or `*.repo.ts` functions; pure logic in `helpers.ts`.
3. New external integration = port interface in `server/src/vendor/shared/adapters.ts`
   (+ client copy if the client needs the type), implementation in
   `server/src/adapters/<name>/`, a lazy getter in `Container`, an override in
   `ContainerOverrides`, and a mock in `adapters/mocks.ts`.
4. Scope every query by `workspaceId`; throw `AppError` subclasses; route run events
   through `RunLogger` (see `server/AGENTS.md`).
5. Pure domain functions get unit tests; anything touching Postgres goes in `*.it.test.ts`.

## Known violations in the current code (do not copy)

These predate this skill. Don't extend them; fix them only in a task that asks for it.

| File | Violation |
|---|---|
| `server/src/modules/polling/routes.ts:28` | route calls `container.github()` and writes PRs with `container.db` |
| `server/src/modules/pulls/routes.ts:38` | `GET /repos/:id/pulls` syncs from GitHub inside the route |
| `server/src/modules/pulls/routes.ts:190, :288, :311` | further `container.github()` calls in route handlers |
| `server/src/modules/settings/routes.ts:43, :80, :83` | route reads/writes `container.secrets` |
| `server/src/modules/settings/routes.ts:87, :91` | route calls `container.github()` / `container.llm(provider)` for test-connection |
| several `routes.ts` (`pulls`, `polling`, …) | direct `container.db` queries instead of a repository |

When reviewing, flag a **new** occurrence of these patterns as a finding; mention an
existing one only if the change touches that handler.
