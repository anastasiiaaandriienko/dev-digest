# CLAUDE.md — DevDigest

Local-first AI pull-request review. Course starter: import a GitHub PR → run reviewer agents → show grounded findings.
Deeper docs: `README.md`, `TESTING.md`, per-package `README.md`, `docs/agent-prompts/`.

## Repository structure

Multi-package repo with NO npm/pnpm workspace: each package has its own `package.json` + lockfile, nothing is published. `server/` imports `reviewer-core` as raw TS via a tsconfig path alias (`@devdigest/reviewer-core` → `../reviewer-core/src`). Shared Zod contracts (`@devdigest/shared`) are vendored as copies: `server/` and `client/` each alias their own `src/vendor/shared`; `reviewer-core/` aliases the server copy.

| Folder | Package | Purpose |
|---|---|---|
| `server/` | `@devdigest/api` | Fastify REST API on :3001; Postgres via Drizzle; clones repos, imports PRs, runs reviews, streams run events over SSE. Modules in `src/modules/<name>/`, registered in `src/modules/index.ts`. |
| `client/` | `@devdigest/web` | Next.js app on :3000 (the studio UI). Talks to the API via `src/lib/api.ts` (`NEXT_PUBLIC_API_BASE`) + React Query hooks in `src/lib/hooks/`. |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure review engine: prompt assembly → LLM structured output → reduce → grounding gate. No DB/GitHub/FS. Imported by the server as raw TS source (`../reviewer-core/src`). |
| `e2e/` | `@devdigest/e2e` | Deterministic browser e2e (agent-browser, no LLM); flows in `e2e/specs/*.flow.json`. |
| `server/src/vendor/shared` | `@devdigest/shared` | Zod contracts used by server + reviewer-core. `client/src/vendor/shared` is a separate manual copy — no sync script or CI check, and the copies already differ. When changing a contract, update both copies (or ask). |

Other: `scripts/` (`dev.sh`, `e2e.sh` — bash), `docs/agent-prompts/` (reviewer prompts), `.github/workflows/` (CI per suite), `.claude/skills/` (agent skills), `docker-compose.yml` (Postgres only). repo-intel (codebase indexer) lives in `server/src/modules/repo-intel/`.

## Tech stack

- **server, client, reviewer-core:** TypeScript, Zod 3, Vitest 2. **e2e:** TypeScript + `tsx` only (no Zod/Vitest). Node ≥ 22, pnpm ≥ 10.
- **server:** Fastify 5 (`fastify-type-provider-zod`, helmet, cors, rate-limit, `fastify-sse-v2`), Drizzle ORM + `drizzle-kit` + `postgres`, Postgres 16 + pgvector (Docker), `octokit`, `simple-git`, `openai`, `@anthropic-ai/sdk`; repo-intel: `@ast-grep/napi`, `@vscode/ripgrep`, `dependency-cruiser`, `graphology`, `js-tiktoken`. Tests use `testcontainers`. Runs via `tsx`.
- **client:** Next.js 15 (App Router), React 19, TanStack React Query 5, `next-intl`, Tailwind 4, `react-markdown`, `mermaid`, `recharts`. Tests: React Testing Library + jsdom.
- **reviewer-core:** `openai` (OpenRouter-compatible provider), Zod.
- **e2e:** `tsx` + external `agent-browser` CLI.
- **Package managers:** `pnpm` for `server/` and `client/`; `npm` for `reviewer-core/` and `e2e/`.

## Development commands

```sh
./scripts/dev.sh                 # Postgres (docker) → .env files → deps → migrate → seed → API :3001 + web :3000
./scripts/dev.sh --no-seed       # also: --no-client, --db-only
docker compose up -d             # Postgres only
cd server && pnpm dev            # API (tsx watch src/server.ts)
cd client && pnpm dev            # web (next dev -p 3000)
```

- Migrations are NOT applied on boot (`cd server && pnpm db:migrate`, seed: `pnpm db:seed`).
- `dev.sh` installs deps and runs migrate + seed — ask the user before running it, any install (`pnpm install`, `npm ci`), `db:migrate`, or `db:seed`. `pnpm dev` on its own is safe.
- Windows: run `scripts/*.sh` from Git Bash or WSL (not PowerShell); `&&` chains need PowerShell 7+.
- API keys / GitHub token: `server/.env` or the Settings UI.

## Validation commands

```sh
cd client        && pnpm typecheck && pnpm test
cd server        && pnpm typecheck
cd server        && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server        && pnpm exec vitest run .it.test                      # integration, needs Docker
cd server        && pnpm test                                          # both
cd reviewer-core && npm run typecheck && npm test
cd e2e           && npm run typecheck && npm test                      # needs running stack + agent-browser
```

- **No lint script and no ESLint/Prettier config exist** — do not invent a lint step; typecheck + tests are the gate.
- CI: one path-filtered workflow per suite in `.github/workflows/`.

## Naming conventions

- **Server files:** kebab-case (`run-executor.ts`, `diff-loader.ts`, `price-book.ts`). Relative imports use the `.js` extension (ESM).
- **Server module layout:** `modules/<name>/routes.ts` (default-export Fastify plugin) + `service.ts` (`XService`) + `repository.ts` (`XRepository`) + `helpers.ts` + `constants.ts`. Sub-repositories are named `*.repo.ts`.
- **DB:** Drizzle schema in `server/src/db/schema/<area>.ts`. Tables and columns are snake_case in SQL and camelCase in TS (`tokensIn: integer('tokens_in')`).
- **API/contract fields:** snake_case in JSON DTOs and Zod contracts (`head_sha`, `start_line`). Enum values come from the Zod contracts verbatim (`CRITICAL`, `bug`, `request_changes`); no TS `enum` — use `z.enum` or string-literal unions.
- **Functions/variables:** camelCase (`parseRepoUrl`, `reviewPullRequest`). **Constants:** UPPER_SNAKE_CASE (`SEVERITY_ORDER`, `DEFAULT_MAP_THRESHOLD_LINES`).
- **Types/classes:** PascalCase, no `I` prefix (`ReviewInput`, `ReviewService`, `AgentsRepository`). DB row types end in `Row` (`AgentRow`). A Zod schema and its inferred type share one name (`Finding`). `*.repo.ts` files export functions, not classes.
- **Client components:** one PascalCase folder per component — `Name/Name.tsx`, `index.ts` (re-export), `constants.ts`, `helpers.ts`, `styles.ts` (exports a `s` object of styles), `Name.test.tsx`. Route-private components live in `_components/`.
- **Client hooks:** `useXxx` in `client/src/lib/hooks/<area>.ts`. UI strings live in `client/messages/en/<namespace>.json` (`useTranslations`).
- **Tests:** `*.test.ts(x)`; DB-backed server tests MUST end in `*.it.test.ts`. Server/reviewer-core tests live in `test/`; client tests are co-located.
- **Style:** server/reviewer-core use single quotes; client uses double quotes.

## Package guides — Read When

Before working in a package, read its `CLAUDE.md` (it links that package's docs and specs):

- **API routes, review runs, SSE/traces, DB access, repo-intel, run cost** → [server/CLAUDE.md](server/CLAUDE.md)
- **UI pages, components, React Query hooks, i18n, L01 review UI** → [client/CLAUDE.md](client/CLAUDE.md)
- **Prompt assembly, LLM structured output, grounding, scoring** → [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md)
- **Browser flows, hermetic e2e stack, seeded review-flow coverage** → [e2e/CLAUDE.md](e2e/CLAUDE.md)

## Engineering insights — Read When

- **Before non-trivial work in a package** → read that package's `INSIGHTS.md` if it exists: `server/`, `client/`, `reviewer-core/`, `e2e/`. Read only the packages the task touches; a missing file is fine — don't create it.
- Insights are guidance, not truth: re-check their `file:line` evidence against current code before relying on them.
- **After verifying a meaningful, non-obvious discovery** (root cause, pitfall, library quirk, cross-package constraint) → `/engineering-insights record`.
- **At wrap-up of a substantial coding/debugging task** → `/engineering-insights wrap-up`.
- Nothing meaningful discovered → write no insight. Rules (format, ownership, append-only, dedup): `.claude/skills/engineering-insights/SKILL.md`.

## Do not touch (without explicit approval)

- **Database migrations:** never create, edit, delete, or regenerate files in `server/src/db/migrations/` (incl. `meta/`); don't run `pnpm db:generate` or `pnpm db:migrate`. Changing `server/src/db/schema/*.ts` requires a new migration → ask first.
- **Lockfiles:** never modify or regenerate `pnpm-lock.yaml` / `package-lock.json`; don't install, add, or upgrade dependencies. Use each package's own manager (`pnpm` in `server/`, `client/`; `npm` in `reviewer-core/`, `e2e/`) — `pnpm install` in an npm package creates a stray `pnpm-lock.yaml`.
- Leave the untracked `pnpm-workspace.yaml` files and `reviewer-core/pnpm-lock.yaml` as they are.
- `server/package.json` is `skip-worktree` locally (see `TESTING.md`); don't rely on its uncommitted scripts.
- `server/clones/**` is runtime data (git-ignored).
