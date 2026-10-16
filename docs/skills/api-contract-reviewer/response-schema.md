---
name: response-schema
description: Check that every HTTP response matches its declared Zod contract - DTO mappers set every field with the right type and nullability, and no internal data leaks.
type: rubric
---

# Response schema

You check that what a route **actually returns** matches the contract clients are told about: the
Zod DTO in `vendor/shared/contracts/*.ts` (for example `Skill`, `Agent`, `Finding`) and the
`toXxxDto` mapper that builds it. A response that drifts from its schema breaks typed clients
silently, even when no field was "removed".

## Report it when the diff does any of these

1. **Mapper and schema disagree** - the Zod object has a field the mapper never sets (or sets
   `undefined`), or the mapper adds a key that is not in the schema.
2. **Wrong type or nullability** - a `Date` returned where the schema says ISO `string` (use
   `.toISOString()`), a `number` returned as a string from Postgres (`count(*)` without `::int`),
   `null` returned for a field that is not `.nullable()`.
3. **Raw DB rows returned** - a handler returns a Drizzle row (`camelCase` keys, internal columns)
   instead of the snake_case DTO, or spreads `...row` into the response.
4. **Internal or sensitive data leaks** - secrets, tokens, `workspace_id` of another workspace,
   file system paths (`clone_path`), stack traces or SQL errors in a response or an error `details`.
5. **Inconsistent shapes for the same resource** - `GET /x/:id` and `GET /x` (or the create /
   update responses) return different shapes for the same DTO.
6. **Errors bypass the envelope** - a route sends `reply.send({ message })` or a bare string
   instead of throwing an `AppError` subclass, so the client does not get
   `{ error: { code, message, details } }`.
7. **Unbounded responses** - a list endpoint returns every row with no limit where the contract or
   the existing endpoints paginate.

## Do NOT report

- Optional fields (`.optional()` / `.nullish()`) that a given endpoint deliberately does not fill,
  when the schema comment says so (for example a count only the list endpoint returns).
- Extra internal fields on objects that never reach a response (repository or service types).
- Formatting differences that JSON serialization already normalizes.
- Validation-error `details` produced by the framework's schema validation (that shape is fixed).
- Anything you would have to guess: if the DTO or mapper is not in the diff, do not assume it is wrong.

## Evidence (required for every finding)

- **file + line** of the mapper or handler line that returns the value.
- **Affected contract**: the route and the DTO field (`GET /agents` - `Agent.skill_count`).
- **Expected vs actual**: the schema type and what the code returns.
- **Impact**: what a client sees (`count arrives as "3", the UI shows 3 twice`, `token leaked to the browser`).

Severity: **CRITICAL** for leaked secrets or internal data and for missing required fields;
**WARNING** for type or nullability mismatches; **SUGGESTION** for inconsistencies with no confirmed
client impact. Category: `bug` (`security` for leaks).

## Examples

**BAD - Postgres count returned as a string (WARNING).** The contract says `z.number().int()`.

```ts
const counts = db
  .select({ skillId: t.agentSkills.skillId, n: sql`count(*)`.as('n') }) // bigint arrives as "3"
```

**GOOD**

```ts
const counts = db
  .select({ skillId: t.agentSkills.skillId, n: sql<number>`count(*)::int`.as('n') })
```

**BAD - raw row returned, internal path leaks (CRITICAL).**

```ts
app.get('/repos/:id', { schema: { params: IdParams } }, async (req) => {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, req.params.id));
  return row; // camelCase keys, clonePath = "/home/me/.devdigest/clones/..."
});
```

**GOOD - mapped DTO, workspace-scoped, 404 through the envelope.**

```ts
app.get('/repos/:id', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  const repo = await service.get(workspaceId, req.params.id);
  if (!repo) throw new NotFoundError('Repo not found');
  return toRepoDto(repo);
});
```

**BAD - Date object where the schema says ISO string (WARNING).**

```ts
export function toScanDto(row: ConventionScanRow): ConventionScan {
  return { id: row.id, started_at: row.startedAt /* Date */, ... };
}
```

**GOOD**

```ts
  return { id: row.id, started_at: row.startedAt.toISOString(), finished_at: row.finishedAt?.toISOString() ?? null };
```

## Finding template

> **WARNING - Response type mismatch: `Agent.skill_count` returned as string**
> `server/src/modules/agents/repository.ts:87` - `GET /agents`.
> Schema: `z.number().int()`. Actual: Postgres `count(*)` is `bigint`, delivered as `"3"`.
> Impact: typed clients get a string; arithmetic and equality checks break.
> Fix: cast in SQL (`count(*)::int`) or convert in the mapper.
