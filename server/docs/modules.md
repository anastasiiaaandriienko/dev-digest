# Server modules: structure and registration

Verified against the source on 2026-10-11. Naming rules (kebab-case files,
`XService`, `XRepository`, `*.repo.ts` exporting functions) are in the root
[../../CLAUDE.md](../../CLAUDE.md); this page shows how they are applied in practice.

## Registration (implemented)

`src/modules/index.ts` exports a static `modules` map. To add one:
1. Add one import of `./<name>/routes.js`.
2. Add one entry to the map.

`buildApp` registers every entry in turn (`src/app.ts:168`).

Filesystem autoload is deliberately not used. `@fastify/autoload` is a dependency
but nothing imports it; the comment in `index.ts` explains why (dynamic `import()`
of `.ts` files does not work the same under tsx, bundlers and vitest).

The starter's modules are: `settings`, `repos`, `pulls`, `polling`, `workspace`,
`agents`, `reviews` and `repoIntel`.

## Anatomy of a route plugin

```ts
// src/modules/<name>/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ThingService } from './service.js';

export default async function thingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ThingService(container);

  app.get('/things/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const thing = await service.get(workspaceId, req.params.id);
    if (!thing) throw new NotFoundError('Thing not found');
    return thing;
  });
}
```

The sketch above follows the pattern of `src/modules/reviews/routes.ts`. Points it shows:

- **Tenancy.** `getContext(container, req)` (`src/modules/_shared/context.ts`) returns
  `{ workspaceId, userId }` through `container.auth`. Every query must filter by `workspaceId`.
- **Params.** Use `IdParams` (`src/modules/_shared/schemas.ts`) for uuid `:id`.
  Non-uuid ids, such as `/providers/:id`, declare their own schema (`agents/routes.ts`).
- **Bodies.** Prefer `schema: { body: Zod }` so invalid input returns 422 before the
  handler runs (example: `POST /repos` in `repos/routes.ts`). `POST /pulls/:id/review`
  parses `RunRequest` by hand on purpose, so that an empty body is accepted.
- **Errors.** Throw `AppError` or a subclass from `src/platform/errors.ts`:
  - `NotFoundError` → 404
  - `ValidationError` → 422
  - `ExternalServiceError` → 502
  - `ConfigError` → 500
- **Rate limits.** Set per route with `config: { rateLimit: { max, timeWindow } }`;
  use `rateLimit: false` for SSE.
- **Responses.** No route declares a `response` schema today. Handlers return plain
  objects typed as the shared contract (for example `Promise<PrMeta[]>` in `pulls/routes.ts`).

## Layering: what the real modules do

| Module | Files | Pattern |
|---|---|---|
| `agents` | `routes`, `service`, `repository`, `helpers`, `constants` | full layering; **best template** |
| `repos` | `routes`, `service`, `repository`, `helpers`, `constants` | full layering + JobRunner handlers (clone → index) |
| `reviews` | `routes`, `service`, `run-executor`, `diff-loader`, `findings`, `helpers`, `constants`, `repository.ts` + `repository/{pull,review,run}.repo.ts` | service plus a background executor; the repository class delegates to the function files |
| `repo-intel` | `routes`, `service`, `repository`, `types`, `constants`, `pipeline/*` | a facade exposed as `container.repoIntel` (see [repo-intel.md](repo-intel.md)) |
| `pulls` | `routes`, `status` | **counter-example**: Drizzle queries live in the route handlers |
| `workspace` | `routes` | smallest module; queries the DB directly and does not use the zod type provider |

For new lesson modules, copy `agents`, not `pulls` or `workspace`.

## Services, repositories and the container

- **Services.** Constructed inside the plugin with `new XService(container)`
  (`agents/routes.ts:72`, `repos/routes.ts:21`, `reviews/routes.ts:22`, `repo-intel/routes.ts:29`).
  They are not registered in the container.
- **Shared repositories.** Cross-module repositories are exposed by the container:
  `container.agentsRepo`, `container.reviewRepo` and `container.repoIntel`. A module
  must use these rather than importing another module's folder.
- **Background jobs.** Register job handlers once when the plugin loads
  (`RepoIntelService.registerIndexJobHandlers()` in `repo-intel/routes.ts`), then
  enqueue with `container.jobs.enqueue(workspaceId, kind, payload)`. `JobRunner`
  (`src/platform/jobs.ts`) has a 120 s default timeout. Review runs do **not** use it.
- **Adapters.** Add a new adapter as a lazy getter plus a `ContainerOverrides` field
  only when tests need to mock it.

## Schema and contracts

- **Tables.** All tables already exist in `src/db/schema/*.ts` (exported through
  `src/db/schema.ts`). Lesson tables such as `skills`, `pr_intent`, `pr_brief`,
  `eval_*`, `memory` and `digests` sit empty until a lesson uses them. Check there
  before proposing a new table.
- **Schema changes.** Changing a schema file requires a new migration. Ask first
  (see the safety rules in [../CLAUDE.md](../CLAUDE.md)).
- **Contracts.** Request and response contracts come from `@devdigest/shared`
  (`src/vendor/shared/contracts/*`). When you change one, update the client copy as
  well; [../INSIGHTS.md](../INSIGHTS.md) lists the files where the copies already differ.

## Checklist for a new module

1. Create `src/modules/<name>/routes.ts` with a default-exported plugin that uses
   `withTypeProvider<ZodTypeProvider>()`.
2. Add `service.ts` and `repository.ts`, scoped by `workspaceId`.
3. Register the module in `src/modules/index.ts`.
4. Add a `test/<name>*.test.ts` route smoke test (`buildApp` + `inject`) and, if it
   touches the DB, a `*.it.test.ts` (see [testing.md](testing.md)).
5. Run `pnpm typecheck` and the relevant tests.
