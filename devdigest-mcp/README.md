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
| `get_findings` | `GET /pulls/:id/reviews` | read-only — verdict + findings: the latest review of each agent, or with `all_runs` every completed review (newest first, ≤ 50) |
| `get_conventions` | `GET /repos/:id/conventions` | read-only — accepted (default), pending, rejected or all rules from L02; never starts a scan |
| `get_blast_radius` | `GET /pulls/:id/blast` | read-only — HW-04 impact map from the repo-intel index: changed symbols, direct callers (file:line, GitHub links pinned to the **indexed** commit), potentially affected endpoints / crons (file-level import graph), totals, `degraded` + `reason`, `source`. No GitHub sync, no LLM |

Ids are DevDigest's internal uuids, not GitHub numbers:

- `agent_id` comes from `list_agents`.
- `repo_id` is in the web app URL `/repos/<repo_id>/…`.
- `pr_id` is the PR's `id` in the DevDigest API (for example the `id` field of `GET /repos/:id/pulls`).

### Inputs (as shown in the MCP Inspector)

| Tool | Fields (`*` = required, in this order) |
|---|---|
| `get_findings` | `pr_id*` (string), `repo` (string), `all_runs` (boolean, default `false`) |
| `get_blast_radius` | `pr_id*` (string), `repo` (string) |
| `run_agent_on_pr` | `pr_id*` (string), `repo` (string), `agent_id*` (string) |
| `list_agents` | `enabled_only` (boolean, default `false`) |
| `get_conventions` | `repo_id*` (uuid), `status` (`accepted` / `pending` / `rejected` / `all`, default `accepted`) |

`pr_id` is one string: the internal uuid, the PR number (`15` or `#15`; a JSON number is accepted too)
or part of the PR title. `repo` (`owner/name`, a short name that is unique, or the repo uuid) narrows a
number or title; it does not apply to a uuid. Unknown fields are rejected (`Unrecognized key`), so the
removed `pr_number`, `pr_title`, `run_id`, `agent_id` (get_findings) and `timeout_seconds` fail loudly.

- A number or title is looked up with `GET /pulls?number=&title=&repo=`: stored PRs only — no GitHub
  sync, no writes. A PR that is not imported into DevDigest is not found.
- Exactly one match is used. Zero matches, several matches (listed with their `pr_id`), an unknown
  repo or an ambiguous short repo name are `isError` results — the first match is never picked.
- `run_agent_on_pr` resolves the PR **before** starting anything: an unresolved PR never starts a paid run.
- Text output starts with `Resolved PR #N in owner/name (pr_id …)` when a number / title was used.

| Inspector field | Example (DevDigest PR #3) |
|---|---|
| `pr_id` | `3`, `#3`, `API contract` or `8750ebba-c970-43f6-9cdb-82a30f5c62a0` |
| `repo` | `anastasiiaaandriienko/dev-digest` (needed for `API contract`, which matches two repos) |

Tools are listed by name (no `title`); read-only tools carry only `readOnlyHint: true`. The
`get_blast_radius` description leaves out "prior PRs touching the same files" — that is P3 and not
implemented.

Tool input/output schemas are written with `zod/v4`, so nullable fields are emitted as
`anyOf: [{…}, {type: null}]` and `inspector --cli --strict` reports no schema-portability findings.

Every tool returns a short text block plus `structuredContent` that matches its output schema.
API failures come back as `isError: true` with a short message (status, error code, sanitized
text), never a stack trace or a credential.

### `run_agent_on_pr` — paid call

`run_agent_on_pr` runs exactly **one** agent on one PR (there is no "run all agents").

- It waits until that run is `done`, `failed` or `cancelled`, or until `DEVDIGEST_RUN_TIMEOUT_MS`
  passes (default 50 s). A review usually takes 30–60 s.
- `timeout`: the run is still going on the server. `poll_error`: the run was started but its status
  could not be read (network error, request timeout, HTTP 429). In both cases the result carries the
  `run_id`; fetch the review later with `get_findings` and `all_runs: true` (each review carries its `run_id`).
- While waiting it sends `notifications/progress` on every poll when the client passed a progress token.
  SDK-based clients (including the Inspector) give up after 60 s by default unless they reset their
  timeout on progress, so the default wait stays below that. For longer waits raise the client timeout
  (Inspector request-timeout setting, `MCP_TOOL_TIMEOUT` for Claude Code) and `DEVDIGEST_RUN_TIMEOUT_MS`.
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

## Context overhead (L04 audit)

Measured on 2026-10-17 with Claude Code 2.1.302 on Windows. Each row is a separate headless
session running only the local `/context` command (no model call, no review, no config change).
"Upfront" is what sits in the context window on every turn; "deferred" schemas are loaded only
when Tool Search fetches a tool.

### Measured

| # | Configuration | MCP tools | Total context | Upfront tools | Deferred schemas |
|---|---|---|---|---|---|
| C | current servers, Tool Search **on** | 38 (Claude Docs 8, devdigest 5, desktop-commander 25) | **25.7k** | system 6.8k + MCP names 0.54k + MCP server instructions 0.96k | MCP 18.7k + system 13.6k |
| B | current servers, Tool Search **off** | 38 | **61.1k** | system 23.5k + MCP 19.3k + instructions 0.96k | — |
| A0 | no MCP (`--strict-mcp-config`, empty config), on | 0 | **24.2k** | system 6.8k | system 13.4k |
| A1 | devdigest only (`--strict-mcp-config`), on | 5 | **24.2k** | system 6.8k; MCP names ≈ 0 (no row in `/context`) | MCP 1.2k |
| A2 | devdigest only (`--strict-mcp-config`), off | 5 | **41.4k** | system 22.7k + MCP 1.2k | — |

For comparison, the interactive session at the same time (Tool Search on) showed 42.4k total,
60 MCP tools (the 38 above + 22 `claude-in-chrome`), MCP names 0.55k, deferred MCP schemas 29.4k.

What the numbers show:

- **Tool Search on saves 35.4k tokens** (B 61.1k → C 25.7k). About 18.8k of that is MCP
  schemas; about 16.7k is Claude Code's **built-in deferred tools**, which are also loaded in full
  when Tool Search is off. So turning it off costs a lot even with few MCP servers (A2: +17.2k over A1).
- **devdigest itself is cheap**: ≈ 0 upfront and 1.2k deferred with Tool Search on (A0 vs A1),
  exactly 1.2k upfront with it off (A2).
- The other MCP servers (desktop-commander, Claude Docs) cost ~1.5k upfront with Tool Search on
  (C vs A1: tool names + server instructions) and ~18k with it off.

### Not measured / estimates

- **Headless vs interactive:** headless (`claude -p`) has no `claude-in-chrome` (22 tools,
  ~10k deferred) and fewer built-in tools, so its totals are lower than an interactive session.
  Compare deltas between rows, not absolute values with an interactive `/context`.
- `--strict-mcp-config` also drops the claude.ai connector (Claude Docs), so A0/A1 are "only
  what the config file lists".
- **GitHub MCP is not configured** (no user/local/project server; the official `github` plugin is
  only in the marketplace, not installed), so its cost was not measured. If added, the official
  server can be limited with `GITHUB_TOOLSETS=repos,pull_requests` and `GITHUB_READ_ONLY=1`
  (remote server: `X-MCP-Toolsets` / `X-MCP-Readonly` headers) — from its docs, not verified here.
  DevDigest does not need it: the API talks to GitHub through `octokit`.

### Recommendations

1. Keep Tool Search on (the default; don't set `ENABLE_TOOL_SEARCH=false`). It is the biggest lever.
2. Keep the devdigest server as is: five tools, 1.2k deferred, nothing worth trimming.
3. For DevDigest-only sessions, start Claude Code with a devdigest-only MCP config
   (`--strict-mcp-config --mcp-config <file>`), or disable unrelated servers for this project in
   `/mcp`. Saves ~1.5k per turn with Tool Search on, ~18k with it off, and leaves the model fewer
   unrelated tools to choose from.
4. Add GitHub MCP only when a task needs it, limited to `repos,pull_requests` and read-only.

### Reproduce

Run from the repo root in PowerShell (Git Bash rewrites `/context` into a Windows path; use
`MSYS_NO_PATHCONV=1` there). The variable only applies to the started process.

```powershell
$D = "$env:TEMP\devdigest-ctx"; New-Item -ItemType Directory -Force $D | Out-Null
$env:ENABLE_TOOL_SEARCH='true';  claude -p "/context" > "$D\ctx-C-ts-true.txt"
$env:ENABLE_TOOL_SEARCH='false'; claude -p "/context" > "$D\ctx-B-ts-false.txt"
$env:ENABLE_TOOL_SEARCH='true'
claude -p "/context" --strict-mcp-config --mcp-config "$D\empty-mcp.json"     > "$D\ctx-A0-strict-empty.txt"
claude -p "/context" --strict-mcp-config --mcp-config "$D\devdigest-mcp.json" > "$D\ctx-A1-strict-devdigest.txt"
$env:ENABLE_TOOL_SEARCH='false'
claude -p "/context" --strict-mcp-config --mcp-config "$D\devdigest-mcp.json" > "$D\ctx-A2-strict-devdigest-tsfalse.txt"
```

`empty-mcp.json` is `{"mcpServers":{}}`; `devdigest-mcp.json` holds only the `devdigest` entry from
[Connect to Claude Code](#connect-to-claude-code-local-scope) with absolute paths; put both in `$D`.
Configs and `ctx-*.txt` outputs stay outside the repo; the raw logs of the run above are kept
locally under those names and are not committed.

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
