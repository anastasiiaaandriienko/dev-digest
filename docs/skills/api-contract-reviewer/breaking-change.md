---
name: breaking-change
description: Flag HTTP API changes that break existing clients - removed or renamed routes, methods, params, request or response fields, and incompatible type changes.
type: rubric
---

# Breaking change

You review a pull request for changes that break **existing API clients**. A change is breaking
when a request that worked before the PR now fails, or a response a client already parses now has
a different shape or meaning. Judge the **public contract**: Fastify routes (`modules/<name>/routes.ts`),
their Zod `schema` (params, querystring, body), and the response DTOs in
`vendor/shared/contracts/*.ts`.

## Report it when the diff does any of these

1. **Route or method removed or changed** - an `app.get/post/put/patch/delete` call is deleted, its
   path changes (`/skills/:id` to `/skills/:skillId/detail`), or its HTTP method changes (`PUT` to `PATCH`)
   with no route left at the old method and path.
2. **Path or query parameter removed, renamed or made stricter** - a `:param` is renamed, a query
   key is renamed, or validation now rejects values that were accepted (`z.string()` to `z.string().uuid()`,
   a lower `.max()`, a new `enum` that excludes old values).
3. **Request body made stricter** - an optional field becomes required, a field is renamed, a
   type is narrowed (`z.union([z.string(), z.number()])` to `z.string()`), or `.strict()` now rejects
   extra keys that clients already send.
4. **Response field removed or renamed** - a key disappears from a DTO, the mapper stops setting it,
   or `snake_case` is renamed (`head_sha` to `headSha`).
5. **Response type changed incompatibly** - `string` to `number`, scalar to object or array, a
   non-null field becomes `.nullable()` or `.optional()`, an enum loses a value, or its values are renamed
   (`CRITICAL` to `critical`).
6. **Status code or error envelope changed** - success code changes (`200` to `201` or `204`), an
   error that was `422` becomes `400`, or the `{ error: { code, message, details } }` shape changes.
7. **Semantics changed under the same shape** - same field, different meaning or unit
   (`cost_usd` now in cents, `order` now 1-based, a list now paginated with the same key).

## Do NOT report

- **Additive changes**: a new route, a new optional request field, a new response field, a new enum
  value the server only *accepts* (not one it now *returns* to strict clients - see rule 5).
- **Internal code**: repositories, services, helpers, DB columns, as long as the HTTP contract is
  unchanged. A renamed TS variable or Drizzle column is not an API change.
- **Routes explicitly marked internal or experimental** in a comment or path (`/internal/...`).
- **Validation that only rejects input the old code could never handle** (it crashed with a 500
  before). Mention it as a SUGGESTION at most.
- **A breaking change the PR handles deliberately**: a versioned route (`/v2/...`) is added while the
  old one stays, or the change is documented with a deprecation period (see `deprecation-policy`).
- Anything you cannot point to in the diff. Never guess what other files contain.

## Evidence (required for every finding)

- **file + line** of the changed contract (the route, the schema field, or the DTO mapper line).
- **Affected contract**: method + path, and the field or param (`PUT /skills/:id` body `enabled`).
- **Before vs after**, in one line each.
- **Impact**: who breaks and how (`clients sending only "name" now get 422`).

Severity: **CRITICAL** when a route, method or response field that clients use is removed or
retyped; **WARNING** for stricter validation or changed status codes; **SUGGESTION** for semantic
risks you cannot fully confirm from the diff. Category: `bug`.

## Examples

**BAD - response field renamed (CRITICAL).** Clients reading `head_sha` now get `undefined`.

```diff
// server/src/modules/pulls/helpers.ts
export function toPullDto(row: PullRow): Pull {
  return {
    id: row.id,
-   head_sha: row.headSha,
+   headSha: row.headSha,
  };
}
```

**BAD - optional body field became required (WARNING).** A client that sent only `{ "name": "x" }`
now gets 422.

```diff
// server/src/vendor/shared/contracts/knowledge.ts
export const SkillCreate = z.object({
  name: z.string().trim().min(1).max(120),
- description: z.string().max(2000).default(''),
+ description: z.string().min(1).max(2000),
```

**BAD - method changed with no route left at the old one (CRITICAL).**

```diff
// server/src/modules/skills/routes.ts
- app.put('/skills/:id', { schema: { params: IdParams, body: SkillUpdate } }, handler);
+ app.patch('/skills/:id', { schema: { params: IdParams, body: SkillUpdate } }, handler);
```

**GOOD - additive and backward compatible (do not report).** A new optional query param with a
default that keeps the old behaviour, and a new response field.

```ts
const StateQuery = z.object({
  include_rejected: z.enum(['true', 'false']).default('false'),
});
// ...
return { ...toAgentDto(row), skill_count: skillCount };
```

**GOOD - breaking change done safely (do not report as breaking).** The old route keeps working and
is marked deprecated while the new one is added.

```ts
app.put('/skills/:id', { schema: { params: IdParams, body: SkillUpdate } }, async (req, reply) => {
  reply.header('Deprecation', 'true');
  return service.update(workspaceId, req.params.id, req.body); // still supported
});
app.patch('/skills/:id', { schema: { params: IdParams, body: SkillUpdate } }, handler);
```

## Finding template

> **CRITICAL - Breaking: response field `head_sha` renamed to `headSha`**
> `server/src/modules/pulls/helpers.ts:14` - `GET /repos/:id/pulls` response `head_sha`.
> Before: `head_sha: string`. After: field missing, `headSha` added.
> Impact: every client that reads `head_sha` (the web app's PR list) gets `undefined`.
> Fix: keep `head_sha`; if a rename is needed, add the new key next to the old one and deprecate the old one.
