# devdigest-mcp

A standalone [MCP](https://modelcontextprotocol.io) server (stdio) that exposes DevDigest to MCP
clients such as Claude Code. It is a **thin HTTP client** of the DevDigest Fastify API: every tool
calls an existing endpoint, and all business logic (reviews, grounding, scoring, conventions)
stays in `server/`.

- TypeScript, ESM, Node ≥ 22, `@modelcontextprotocol/sdk` v1, Zod 3, run with `tsx` (no build step).
- Its own `package.json` / `package-lock.json` (npm), like `reviewer-core/` and `e2e/`.
- It starts without the API, but tool calls need the API to be running (`cd server && pnpm dev`).

## Tools

| Tool | API it calls | Effect |
|---|---|---|
| `list_agents` | `GET /agents` | read-only — ids, names, model, enabled state (no system prompts) |
| `run_agent_on_pr` | `POST /pulls/:id/review`, then polls `GET /pulls/:id/runs`, then `GET /pulls/:id/reviews` | **starts a review run: writes runs/reviews/findings and makes a PAID LLM call** |
| `get_findings` | `GET /pulls/:id/reviews` (+ `GET /pulls/:id/runs` when a run has no review) | read-only — verdict + findings of a run, of an agent's latest review, or the latest review of every agent |
| `get_conventions` | `GET /repos/:id/conventions` | read-only — accepted (default), pending, rejected or all rules from L02; never starts a scan |
| `get_blast_radius` | — | read-only stub: returns `status: "not_implemented"` (implemented in HW-04 from repo-intel) |

Ids are DevDigest's internal uuids, not GitHub numbers:

- `agent_id` comes from `list_agents`.
- `repo_id` is in the web app URL `/repos/<repo_id>/…`.
- `pr_id` is the PR's `id` in the DevDigest API (for example the `id` field of `GET /repos/:id/pulls`).
  The MCP server does not look PRs up on GitHub.

Every tool returns a short text block plus `structuredContent` that matches its output schema.
API failures come back as `isError: true` with a short message (status, error code, sanitized
text), never a stack trace or a credential.

### `run_agent_on_pr` — paid call

`run_agent_on_pr` runs exactly **one** agent on one PR (there is no "run all agents").

- It waits until that run is `done`, `failed` or `cancelled`, or until the timeout passes
  (`timeout_seconds`, default 50 s, max 600 s). A review usually takes 30–60 s.
- `timeout`: the run is still going on the server. `poll_error`: the run was started but its status
  could not be read (network error, request timeout, HTTP 429). In both cases the result carries the
  `run_id`; fetch the review later with `get_findings` and that `run_id`.
- While waiting it sends `notifications/progress` on every poll when the client passed a progress token.
  SDK-based clients (including the Inspector) give up after 60 s by default unless they reset their
  timeout on progress, so the default wait stays below that. For longer waits raise the client timeout
  (Inspector request-timeout setting, `MCP_TOOL_TIMEOUT` for Claude Code) and pass `timeout_seconds`.
- Each call costs money (one LLM review) and creates rows in the DevDigest database.
- Keep this tool behind a permission prompt in your MCP client; don't allow it by default.

## Install

```sh
cd devdigest-mcp
npm ci            # or `npm install` the first time
npm run typecheck
npm test          # unit tests: fake fetch, no network, no LLM
```

## Run

```sh
cd devdigest-mcp
npm start         # = tsx src/index.ts — speaks MCP on stdin/stdout
```

stdout carries only the MCP protocol; logs go to stderr.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_BASE` | `http://localhost:3001` | Base URL of the DevDigest API (http/https, no credentials) |
| `DEVDIGEST_REQUEST_TIMEOUT_MS` | `15000` | Timeout of one HTTP request (1 000–120 000) |
| `DEVDIGEST_RUN_TIMEOUT_MS` | `50000` | Default wait of `run_agent_on_pr` (10 000–600 000) |
| `DEVDIGEST_POLL_INTERVAL_MS` | `3000` | Delay between run-status polls (2 000–60 000; the API allows 120 requests/min per IP, shared with the web app) |

The local API needs no auth header, so the MCP server holds no secrets.

## MCP Inspector

Needs Node ≥ 22.19 for the Inspector itself. From `devdigest-mcp/`:

```sh
# Web UI
npx @modelcontextprotocol/inspector npx tsx src/index.ts

# CLI: list tools, call a read-only tool
npx @modelcontextprotocol/inspector --cli npx tsx src/index.ts --method tools/list
npx @modelcontextprotocol/inspector --cli npx tsx src/index.ts --method tools/call --tool-name list_agents
```

Pass a different API with `-e DEVDIGEST_API_BASE=http://localhost:3001` before the command.
Don't call `run_agent_on_pr` from the Inspector unless you mean to pay for a review.

## Connect to Claude Code (local scope)

`local` scope stores the server in your `~/.claude.json` for this project only (nothing is committed).
Use an absolute path:

```sh
claude mcp add devdigest -s local --transport stdio \
  -e DEVDIGEST_API_BASE=http://localhost:3001 \
  -- npx tsx /absolute/path/to/dev-digest/devdigest-mcp/src/index.ts
```

On Windows, if `npx` is not found by Claude Code, use `cmd /c npx tsx …` as the command, or
`node /absolute/path/to/devdigest-mcp/node_modules/tsx/dist/cli.mjs /absolute/path/to/devdigest-mcp/src/index.ts`.

Then check with `claude mcp list` or `/mcp` inside Claude Code. Tool permission names are
`mcp__devdigest__<tool>`, e.g. `mcp__devdigest__list_agents`. Allow the read-only tools if you
like; keep `mcp__devdigest__run_agent_on_pr` on "ask".

## Layout

Dependencies point inward (the project's onion-architecture rule, applied to a small package):
`index.ts` (composition root) → `server.ts` (MCP SDK) → `tools/*` → `devdigest-api.ts` → `api-client.ts` (fetch).
Only `index.ts` and `server.ts` import the MCP SDK, and only `devdigest-api.ts` knows API paths;
`test/architecture.test.ts` enforces both, and that there are no import cycles.

```
src/
  index.ts            composition root: config, HTTP client, stdio transport (logs to stderr)
  server.ts           createServer(): registers the five tools, maps progress to MCP notifications
  tools/              one file per tool: input/output schema, annotations, handler (orchestration + mapping)
  devdigest-api.ts    the DevDigest endpoints used (paths + response schemas); tools call these methods
  api-client.ts       fetch wrapper: timeouts, error envelope, Zod-validated responses
  api-schemas.ts      the API response fields this server reads
  errors.ts           ApiError + message sanitizing (shared by the client and the tools)
  findings.ts         compact review/finding view shared by two tools
  tool-result.ts      ok()/fail()/clip() result helpers
  config.ts           env → config (validated)
  logger.ts           stderr logger
test/                 vitest unit tests (fake fetch; real network is blocked)
```
