# Spec: L07 worktree B — Export agent to CI (GitHub Actions) + CI Runs

- **Key:** CI · **Status:** Draft v3 — all decisions applied, no open questions · **Date:** 2026-10-23 · **Packages:** server | client | contracts | agent-runner (reviewer-core: read-only reuse)
- **Source request:** L07 lab "Multi-Agent Review + Export to CI via git worktree fan-out", worktree B (relayed by the main agent for the user, 2026-10-23). User decisions applied 2026-10-23 (§15).
- **Design reference:** screenshots 1-5 (agent CI tab, wizard steps Target/Preview/Configure/Install); `DevDigest Design (standalone) (1).html` contains artboards `CI Runs (N13)` and `CI Runs · empty` (`window.ScreenCIRuns`), whose component source was not inspected.

## 1. Goals
- G1. "+ Add to CI" on an agent opens a 4-step Export Wizard (Target → Preview → Configure → Install) that generates the CI files for one target repo.
- G2. Install opens (or updates) a PR on branch `devdigest/ci` (never writes to the base branch), or downloads the same files as a zip.
- G3. The generated GitHub Actions workflow runs the **bundled** `agent-runner` (`node .devdigest/runner/index.js`) on `pull_request` events, posts the review, and fails the check when the agent's `ci_fail_on` gate triggers.
- G4. The studio pulls finished CI runs from GitHub Actions artifacts (manual Sync + throttled automatic sync) and stores each as `agent_runs(source='ci')` + `ci_runs`, linked to repo, PR, commit SHA and the Actions job.
- G5. A CI Runs page and an agent "CI" tab show installations, history and the "Fail CI on" setting.

## 2. Non-goals
- Generators for CircleCI, Jenkins, Generic CLI (cards shown disabled).
- Publishing a reusable GitHub Action (`devdigest/review-action@v1` in the mockup is a placeholder).
- Secrets for fork PRs or any `pull_request_target` workaround.
- Push-based ingest endpoint; background polling loops.
- Per-finding ingest of CI findings (MVP stores counts only).
- More than one agent per target repo (MVP limit). **Future:** runner support for multiple manifests; the DB key and per-slug manifest path already allow it (shared section S.2).
- `.devdigest/memory.jsonl` (the runner does not read it).
- The multi-run service, PR feed, finding attribution (worktree A), the agent "Stats" tab, Memory / Agent Performance pages.
- Configuring branch protection / rulesets in the target repo (the wizard explains it, the user does it).
- Changes to reviewer-core; any schema/migration change inside worktree B (shared section S.1).

## 3. Actors and triggers
| Actor | Trigger | Effect |
|---|---|---|
| Studio user | Agent page → CI tab → "+ Add to CI" / "+ Add repository" / "Update CI config" | Opens the wizard (prefilled for Update) |
| Studio user | Wizard → Install | `POST /agents/:id/export-ci` (open/update PR) or zip download |
| Target-repo maintainer | Reviews the `devdigest/ci` PR, adds the `OPENROUTER_API_KEY` Actions secret, merges, marks the check required | CI becomes active |
| GitHub Actions (target repo) | `pull_request` opened / synchronize / (reopened), same-repo PRs only | Runs the bundled runner, posts, sets the exit code, uploads `devdigest-result` |
| Studio user | "Sync" on CI Runs or per installation on the CI tab | Manual ingest (rate-limited) |
| Studio client | Opening CI Runs or the CI tab | Automatic ingest of installations whose `last_synced_at` is older than 10 min |

## 4. Current state (verified, path:line)
- No `server/src/modules/ci/`; modules registered statically in `server/src/modules/index.ts:2-15` (no `ci`).
- Contracts (server copy only): `CiTarget` `server/src/vendor/shared/contracts/eval-ci.ts:133`, `CiFile` :137 (`editable` default true), `AgentManifest` :152-168 (no `post_as`, no version), `CiExportInput` :174-182 (`base` default `'main'`, `post_as` default `github_review`, triggers default all three), `CiInstallation` :188, `CiExport` :198 (`pr_url`), `CiRunStatus` :205, `CiRun` :209-221 (comment :208 "ingested from GitHub Actions artifacts"), `CiResultArtifact` :228-238 (counts only, no SHA, no model; comment :226 "Ingested back on refresh"). The client copy has `CiExportInput` (`client/src/vendor/shared/contracts/eval-ci.ts:145`) and `CiResultArtifact` (:199) but **no `AgentManifest`**.
- Tables: `ci_installations` (agent_id, repo text, target_type, installed_at) and `ci_runs` (ci_installation_id, pr_number, ran_at, status, findings_count, cost_usd, github_url, source) — `server/src/db/schema/ci.ts:4-26`; unused by any module; no unique keys.
- `agent_runs.source` enum `local|ci` default `local` (`server/src/db/schema/runs.ts:24`), `prId` nullable FK (:14), `blockers` (:30); trace in `run_traces` jsonb (:34-39). Local run cost is read from the trace (`traceCostUsd()`, `server/src/modules/reviews/repository/run.repo.ts:51`).
- `agents.ci_fail_on` (`server/src/db/schema/agents.ts:25`), `agents.version` (:33); `PATCH` supports `ci_fail_on` (`server/src/modules/agents/routes.ts:56`). Skills have `name`, `version`, no slug column (`server/src/db/schema/skills.ts:10,18`).
- Latest migration `server/src/db/migrations/0015_quick_red_wolf.sql`.
- `GitHubClient` has `openPullRequest`, `commitFiles`, `findOpenPr` (`server/src/vendor/shared/adapters.ts:155-163`); octokit impl `server/src/adapters/github/octokit.ts:245,264,332` (`commitFiles` force-updates an existing branch, :309-316); mocks `server/src/adapters/mocks.ts:218-228`. No workflow-run / artifact / default-branch methods.
- Server has `fflate` (`server/package.json:32`, used in `server/src/modules/skills/import/zip.ts:2`); no direct YAML dependency. `verify:l06` script `server/package.json:16`.
- agent-runner: exactly one `.devdigest/agents/*.yaml` or it fails (`agent-runner/src/manifest.ts:40-44`); `DEVDIGEST_POST_AS` default `github_review` (`agent-runner/src/index.ts:25-28,33`); always `OpenRouterProvider` (:39); `GITHUB_TOKEN` required unless `none` (`agent-runner/src/run.ts:100-102`); diff fetched via API and `.devdigest/**` stripped (:108-109); artifact written before posting (:149); exit 1 iff gate triggered (:161) **or** hard failure with no artifact and nothing posted (:171). Artifact fields `agent-runner/src/artifact.ts:34-44`, `RUNNER_VERSION='1'` (:6). Fork flag informational only (`agent-runner/src/context.ts:30-31`). The runner does not read `.devdigest/memory.jsonl`. `dist/` is gitignored (`agent-runner/README.md:80`).
- Client: `ExportWizardSteps({ step, labels })` (`client/src/vendor/ui/ExportWizardSteps.tsx:6`), unused. Agent editor tabs: config/skills/context/evals (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12-17`). Sidebar `NAV` has WORKSPACE and SKILLS LAB only (`client/src/vendor/ui/nav.ts:21-41`).

## 5. Inputs and provenance
| Input | Source | Trust | Validation / limits |
|---|---|---|---|
| Agent config (name, model, provider, system_prompt, strategy, ci_fail_on, version) | DB, workspace-scoped | trusted (user-authored) | Must serialize to a valid `AgentManifest` |
| Linked enabled skills (name, body, order) | DB | trusted | Slug collision → 422 |
| `repo` (`owner/name`) | wizard picker (workspace repos) | user input | `owner/name`; connected workspace repo |
| `triggers`, `post_as`, `target`, `base`, `action` | wizard | user input | `CiExportInput` Zod; triggers ⊆ {opened, synchronize, reopened}, ≥1; `base` optional (default = repo default branch) |
| Edited workflow text | wizard Preview | user input | ≤ 64 KB (Q24 decision, AC-CI-83); must not contain `pull_request_target` |
| Runner bundle | `agent-runner/dist/index.js` read at export time | trusted build output | Missing → error naming `cd agent-runner && pnpm build` |
| Workflow run metadata (run id, head SHA, repo id, PR number, conclusion, html_url) | GitHub API, studio token | GitHub-asserted | Must match installation repo + workflow path |
| `devdigest-result.json` | Actions artifact | **untrusted** | `CiResultArtifact.safeParse`; numbers ≥ 0; PR number cross-checked |
| PR title / body / branch names | GitHub | **untrusted** | Rendered as text only; never interpolated into workflow `run:` |
| `OPENROUTER_API_KEY`, `GITHUB_TOKEN` | GitHub Actions secrets | secret | Referenced only as `${{ secrets.X }}`; never read by the studio |

## 6. Outputs (contracts, UI, persistence, trace)
### 6.1 API (owned by B; names proposed)
- `POST /agents/:id/ci/preview` body `CiExportInput` → `{ files: CiFile[] }`. No writes.
- `POST /agents/:id/export-ci` body `CiExportInput & { files?: CiFile[] }` (override for the workflow file only) → `CiExport` (`pr_url` set for `open_pr`). Same agent + repo → update; other agent on repo → 409 `ci_repo_has_agent`.
- `POST /agents/:id/export-ci/zip` same body → `application/zip` (server-side `fflate`); also upserts the installation (`pending`).
- `GET /agents/:id/ci/installations` → installations with `status`, `agent_version`, `pr_url`, `last_synced_at`, last run status/time.
- `GET /ci/runs` → `CiRun[]` (+ repo, verdict, commit_sha, agent name), newest first, workspace-scoped; optional `agent_id`, `repo` filters (used by CI tab history links).
- `POST /ci/runs/sync` body `{ mode: 'auto' | 'manual', installation_id?: uuid }` → `{ ingested, skipped, throttled, errors[] }`.
- New `GitHubClient` methods (+ octokit + mocks): default branch of a repo, list workflow runs for a workflow file, list run artifacts, download artifact zip.
### 6.2 Contracts (both vendored copies change identically)
- Client copy: add `AgentManifest` (+ `CiFailOn` import) to match the server.
- `AgentManifest`: optional `version` (agent version at export).
- `CiExportInput`: add optional `files`; `base` optional (no `'main'` default); `post_as` default `pr_comment`.
- `CiInstallation`: add `status`, `agent_version`, `pr_url`, `updated_at`, `last_synced_at`.
- `CiRun`: add `repo`, `commit_sha`, `verdict`, `agent_run_id`.
- `CiResultArtifact`: optional `model`, `manifest_version`, `gate_triggered`, `blockers`. All additions nullish → older bundles still validate.
- agent-runner writes the new artifact fields (rebuild required).
### 6.3 UI (client)
- **Agent CI tab** (`?tab=ci`): header "CI deployment" + badge "Active in N repos"; buttons "Update CI config", "+ Add to CI"; installation rows (repo, "GitHub Actions", status badge pending/active/error, last run status + relative time, workflow version = `agent_version`, link to PR while pending, "Sync" button, "History" link); "+ Add repository"; "Fail CI on" select (never/critical/warning/any) with a note that the repo copy changes only after "Update CI config". States: loading, empty ("Not deployed to CI yet" + "+ Add to CI"), error + Retry.
- **Wizard modal** "Export to CI — Run <agent> automatically on pull requests", stepper via `ExportWizardSteps`. Close (×/Esc) discards state; nothing is written before Install.
  - Step 1 Target: repo picker (workspace repos, default = active repo); cards GitHub Actions (selected, "recommended", "Runs on pull_request events"), CircleCI / Jenkins / Generic CLI disabled with "Not available yet". If the chosen repo already has another agent installed, an inline warning names it and Continue is disabled.
  - Step 2 Preview: "FILES TO CREATE" + right pane; only the workflow is editable ("editable" tag); manifest shows the resolved OpenRouter model id. Loading, error + Retry.
  - Step 3 Configure: trigger chips (opened on, synchronize on, reopened off); "Secrets expected" OPENROUTER_API_KEY / GITHUB_TOKEN with static badges "required" / "auto-provided" and hint "Add these to your repo's Actions secrets before the workflow runs"; "Post results as" PR comment (preselected) / GitHub review (note: needs the repo setting that lets Actions create PR reviews) / None (exit code only); info box: Fail CI on + required status check in branch protection/ruleset. If the workflow was edited, changing an option asks "Regenerate workflow? Your edits will be lost" (cancel keeps the previous option).
  - Step 4 Install: "Open a PR with these files" (default; "DevDigest opens a PR in <repo> titled 'Add DevDigest CI review' with the N generated files"; for an existing installation "Update the existing PR") / "Copy files as a zip"; help link to GitHub Docs "Using secrets in GitHub Actions" (Q28, AC-CI-84); Install disabled while pending. Success → toast with PR link, modal closes, CI tab refreshes. Failure → inline error, Install re-enabled.
- **CI Runs page** `/ci-runs`, item "CI Runs" in the GLOBAL sidebar section created by A: table repository, PR (#n), agent, verdict (Blocked / Passed / Failed), findings, cost (`—` when null), duration, short commit SHA, "View job" link; Sync button; loading / empty (CTA to Agents) / error states. Layout per Q20 decision (AC-CI-82): columns in AC-CI-51 order, newest 50 rows, `agent_id`/`repo` filters only via URL query, no header stats, no pagination in the MVP.
### 6.4 Persistence (migration 0016 (S.2), created in the pre-fan-out prep commit (S.1), not by worktree B)
- `ci_installations`: one row per (`agent_id`, `repo`, `target_type`) (unique `ci_installations_agent_repo_target_uq`); writes `status` (`pending` on export/zip, `active` after ≥1 ingested run, `error` on sync auth/404 failure), `agent_version`, `pr_url`, `updated_at`, `last_synced_at`.
- Per ingested CI run (S.3): `agent_runs` (`source='ci'`, `agent_id` from the installation, `model`, `provider='openrouter'`, `status`, `findings_count`, `blockers`, `duration_ms`, `pr_id` NULL unless the PR is imported, `multi_agent_run_id` NULL) + `run_traces` + `ci_runs` (`agent_run_id`, `ci_installation_id`, `github_run_id`, `commit_sha`, `github_repo_id`, `pr_number`, `github_url`, `ran_at`, `status`, `findings_count`, `cost_usd`, `source='ci'`). Idempotency via unique (`ci_installation_id`, `github_run_id`).
### 6.5 Trace (per CI run)
`{ source: 'ci', manifest_version, model, dependencies: { runner_version, skills: [slugs] }, commit_sha, repo, github_repo_id, pr_number, github_run_id, github_run_url, cost_usd, severity counts, gate_triggered }`. No env values, no tokens.

## 7. Functional requirements
- FR-1 Wizard navigation and states → AC-CI-01..08, 18, 19.
- FR-2 Configure options → AC-CI-09..13, 79.
- FR-3 Manifest + skills generation → AC-CI-20..22.
- FR-4 Workflow generation. Exact files: `.devdigest/agents/<slug>.yaml` (JSON-compatible YAML), `.devdigest/skills/<skill-slug>.md` per enabled linked skill in order, `.devdigest/runner/index.js`, `.github/workflows/devdigest-review.yml` → AC-CI-23..29, 38, 78.
- FR-5 Install via PR on `devdigest/ci`, update and one-agent-per-repo rule → AC-CI-14..16, 30..32, 36, 37, 80.
- FR-6 Zip download → AC-CI-17, 39.
- FR-7 Scoping and validation → AC-CI-33..35.
- FR-8 Gate/blocking → AC-CI-70, 71, 81.
- FR-9 Ingest by pulling Actions artifacts → AC-CI-40..49, 55..58.
- FR-10 CI Runs page + sidebar → AC-CI-50..54.
- FR-11 Agent CI tab → AC-CI-60..67.
- FR-12 Security invariants → AC-CI-75..78.

**Ingest design (decided: pull).** The workflow uploads `devdigest-result.json` via `actions/upload-artifact` (SHA-pinned). The studio, with its own GitHub token, lists completed runs of `devdigest-review.yml` per installation, downloads the `devdigest-result` artifact and unzips it with `fflate`. Authenticity = the GitHub API over the studio's token; commit SHA, repo id, PR number and URL come from the workflow-run object, not from the artifact; the artifact carries no secret. Rejected: push endpoint (the local studio on `localhost:3001` is unreachable from GitHub-hosted runners and it needs an extra secret or OIDC). Sync triggers: manual (rate-limited: one manual sync per installation per 60 s) and automatic on page open, only for installations whose `last_synced_at` is older than 10 minutes. No background loop. Each sync reads at most the 20 newest completed runs per installation.

## 8. Constraints
- File ownership and merge order: shared section S.4 / S.5. B additionally owns `client/src/app/ci-runs/**`, the CI tab and wizard under `client/src/app/agents/[id]/_components/**`, `AgentEditor/constants.ts` tab entry, `client/src/lib/hooks/ci.ts`, `client/messages/en/ci.json`, `server/test/ci-*.test.ts`.
- B makes no change under `server/src/db/**` (schema and migration 0016 come from the prep commit); a further schema need → stop and ask.
- Forbidden: everything owned by A in S.4, `reviewer-core/**`, lockfiles, `package.json` deps.
- MVP: one agent per target repo, enforced in the service (runner reads exactly one manifest). Manifest path stays per-slug.
- Writing `.github/workflows/*` via the API needs the studio token's workflow permission (A4).
- Simplicity: on runner hard failure nothing is posted (existing behaviour).

## 9. Security
- No `pull_request_target`; trigger is `pull_request` only. Fork PRs: job skipped via `if: github.event.pull_request.head.repo.full_name == github.repository`.
- `permissions:` at workflow level: `contents: read`, `pull-requests: write` (`pull-requests: read` when post_as is `none`); every other scope none.
- External actions pinned to a full 40-hex commit SHA (constants in `ci/constants.ts`); no tag refs.
- Checkout of `github.event.pull_request.base.sha`: a PR cannot alter the runner, manifest or `ci_fail_on` it is judged by; the runner fetches the diff via API (`run.ts:108`).
- PR title/body/branch names are never interpolated with `${{ }}` inside `run:`; the runner reads them from `GITHUB_EVENT_PATH` and `wrapUntrusted`s them (existing).
- The studio never reads Actions secret values; generated files, API responses, artifact, logs and traces contain no secret values. Ingested artifacts are untrusted: schema-validated, cross-checked, rendered as text.
- All ci queries scoped by `workspaceId` (`getContext()`); `:id` validated with `IdParams`.

## 10. Performance
- Automatic sync throttle 10 min per installation; manual sync ≤ 1 per installation per 60 s; ≤ 20 runs read per installation per sync (confirmed, user 2026-10-23).
- No latency or bundle-size target in the MVP (Q26 decision): preview/export latency and the size of `agent-runner/dist/index.js` are measured and recorded, not gated (AC-CI-85). GitHub calls reuse the adapter's timeout + retry.

## 11. Error handling and failure modes
| Failure | Behaviour | AC |
|---|---|---|
| Preview generation fails (slug collision, invalid manifest) | 422; Preview shows error + Retry | AC-CI-08, 22 |
| Runner bundle not built | Error naming `cd agent-runner && pnpm build` | AC-CI-38 |
| GitHub auth / repo 404 / missing workflow permission / timeout on install | AppError → inline error on Install; no new installation row | AC-CI-16, 34 |
| Same agent re-exported to same repo | Update installation + reuse/update `devdigest/ci` PR | AC-CI-31, 36 |
| Different agent, repo has pending/active installation | 409 `ci_repo_has_agent` naming the installed agent | AC-CI-37 |
| Workflow run has no artifact (runner hard fail) | Stored as `failed`, findings null | AC-CI-46 |
| Artifact invalid / PR mismatch / foreign repo or workflow | Skipped with reason, no row | AC-CI-41..43 |
| Same run synced twice | One row | AC-CI-44 |
| Page opened within 10 min of last sync | No GitHub call | AC-CI-55 |
| Manual sync repeated within 60 s | Reported `throttled`, no GitHub call | AC-CI-56 |
| One installation's GitHub call fails during sync | Others processed; error listed; that installation `error` | AC-CI-48, 58 |
| Fork PR | Job skipped | AC-CI-27 |

## 12. Acceptance criteria (EARS)
| AC-ID | EARS statement | Verification |
|---|---|---|
| AC-CI-01 | When the user clicks "+ Add to CI" or "+ Add repository" on the CI tab, the client shall open the Export to CI modal on step Target with the agent name in the subtitle. | unit |
| AC-CI-02 | The wizard shall render the stepper Target/Preview/Configure/Install with `ExportWizardSteps`, marking earlier steps completed. | unit |
| AC-CI-03 | The Target step shall show GitHub Actions selected by default with a "recommended" badge. | unit |
| AC-CI-04 | The Target step shall render CircleCI, Jenkins and Generic CLI cards disabled with "Not available yet" and not selectable. | unit |
| AC-CI-05 | The Target step shall show a repo picker of workspace repos defaulting to the active repo, and enable Continue only when a repo is selected and no other agent is installed there. | unit |
| AC-CI-06 | When the user enters Preview, the client shall call the preview endpoint and list every returned file path under "FILES TO CREATE", showing the selected file's contents. | unit |
| AC-CI-07 | The Preview step shall make only `.github/workflows/devdigest-review.yml` editable (with the "editable" tag) and keep its edits across Back/Continue until the modal closes. | unit |
| AC-CI-08 | If the preview request fails, then the client shall show the error with Retry and disable Continue. | unit |
| AC-CI-09 | The Configure step shall default triggers to opened and synchronize on, reopened off, and shall disable Continue when none is selected. | unit |
| AC-CI-10 | When a Configure option changes after the workflow was edited, the client shall ask to regenerate; on confirm it shall regenerate the workflow and drop the edits, on cancel it shall restore the previous option. | unit |
| AC-CI-11 | The Configure step shall list OPENROUTER_API_KEY ("required") and GITHUB_TOKEN ("auto-provided") with static badges and shall never request, fetch or display a secret value. | unit |
| AC-CI-12 | The Configure step shall offer PR comment, GitHub review and None (exit code only), with PR comment preselected. | unit |
| AC-CI-13 | The Configure step shall state that blocking merge requires "Fail CI on" plus a required status check in branch protection or a ruleset. | unit |
| AC-CI-14 | The Install step shall offer "Open a PR" (default) naming the target repo and the actual file count, and "Copy files as a zip". | unit |
| AC-CI-15 | When the open-PR install succeeds, the client shall show a success toast linking `pr_url`, close the modal and invalidate the installations query. | unit |
| AC-CI-16 | If the install request fails, then the client shall stay on Install, show the server message and re-enable Install. | unit |
| AC-CI-17 | When the user installs via zip, the client shall download a zip whose entries equal the previewed files including edits. | unit + integration (approval) |
| AC-CI-18 | When the user closes the modal (× or Esc) before Install, the client shall discard wizard state and make no write request. | unit |
| AC-CI-19 | While an install request is pending, the client shall disable Install and Back. | unit |
| AC-CI-20 | When preview is requested, the server shall return exactly the FR-4 file set (no `memory.jsonl`), deterministically for the same agent version and input. | unit |
| AC-CI-21 | The generated manifest shall be JSON-compatible YAML that validates against `AgentManifest`, with name, `version` = agent version, system_prompt, strategy, ci_fail_on, enabled skill slugs in link order, and model = `model` for openrouter agents or `<provider>/<model>` otherwise. | unit |
| AC-CI-22 | If the agent slug (kebab-case of the name) is empty or two skill slugs collide, then the server shall respond 422 naming the conflict. | unit |
| AC-CI-23 | The generated workflow shall trigger only on `pull_request` with the selected types and shall never contain `pull_request_target`. | unit |
| AC-CI-24 | The generated workflow shall declare `contents: read` and `pull-requests: write` (`read` when post_as is `none`) and no other scope. | unit |
| AC-CI-25 | Every `uses:` in the generated workflow shall reference a full 40-hex commit SHA, and none shall reference `devdigest/review-action`. | unit |
| AC-CI-26 | The generated workflow shall run `node .devdigest/runner/index.js` with `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `PR_NUMBER` and `DEVDIGEST_POST_AS` equal to the selected post_as, and `.devdigest/runner/index.js` shall be byte-equal to `agent-runner/dist/index.js`. | unit |
| AC-CI-27 | The generated workflow job shall be skipped when the PR head repository differs from the base repository (fork). | unit |
| AC-CI-28 | The workflow shall upload `devdigest-result.json` as artifact `devdigest-result` even when the review step fails, ignoring a missing file. | unit |
| AC-CI-29 | The generated files and API responses shall contain no secret values and shall not interpolate PR title, body or branch names into `run:` scripts. | unit |
| AC-CI-30 | When export runs with `action=open_pr`, the server shall commit all files in one commit to branch `devdigest/ci` from the base branch and open a PR titled "Add DevDigest CI review", never committing to the base branch. | integration (approval) |
| AC-CI-31 | If an open PR from `devdigest/ci` already exists, then the server shall add the commit to that branch and return the existing PR URL. | integration (approval) |
| AC-CI-32 | When export or zip succeeds for a new (agent, repo, target), the server shall insert one `ci_installations` row with `status='pending'`, `agent_version`, `pr_url` (open_pr only). | integration (approval) |
| AC-CI-33 | If the agent id is not in the caller's workspace, then the ci endpoints shall respond 404; a non-uuid id shall get 422. | integration (approval) |
| AC-CI-34 | If a GitHub call fails during export, then the server shall return an `AppError` with the GitHub reason and create no installation row. | integration (approval) |
| AC-CI-35 | If `repo` is not `owner/name`, is not a workspace repo, or a trigger is outside {opened, synchronize, reopened}, then the server shall respond 422. | unit |
| AC-CI-36 | When the same agent is exported again to a repo where it is installed, the server shall regenerate the files, reuse/update the `devdigest/ci` PR and update the existing row (`agent_version`, `pr_url`, `updated_at`) without inserting a new one. | integration (approval) |
| AC-CI-37 | If another agent has a `pending` or `active` installation for the repo, then the server shall respond 409 `ci_repo_has_agent` with a message naming that agent, and write nothing to GitHub or the DB. | integration (approval) |
| AC-CI-38 | If `agent-runner/dist/index.js` does not exist at preview/export time, then the server shall fail with a message naming `cd agent-runner && pnpm build`. | unit |
| AC-CI-39 | When the zip export succeeds, the server shall upsert the installation with `status='pending'` and `pr_url` null. | integration (approval) |
| AC-CI-40 | When `POST /ci/runs/sync` runs for an installation, the server shall list up to 20 newest completed `devdigest-review.yml` runs and ingest those not yet stored, then set `last_synced_at`. | integration (approval) |
| AC-CI-41 | If an artifact fails `CiResultArtifact` validation, then the server shall skip it with a reason and write no row. | integration (approval) |
| AC-CI-42 | The server shall take commit SHA, `github_repo_id`, PR number and run URL from the GitHub workflow-run object, and skip runs whose artifact `pr_number` differs. | integration (approval) |
| AC-CI-43 | If a workflow run's repository or workflow path does not match the installation, then the server shall skip it. | integration (approval) |
| AC-CI-44 | When the same `github_run_id` is synced again for an installation, the server shall not create a second `agent_runs` or `ci_runs` row. | integration (approval) |
| AC-CI-45 | When a valid run is ingested, the server shall write `agent_runs` (`source='ci'`, installation's `agent_id`, model, status, findings_count, blockers, duration) + `run_traces` with the §6.5 fields + `ci_runs` linked by `agent_run_id`. | integration (approval) |
| AC-CI-46 | If a completed run has no artifact, then the server shall store it with status `failed` and null findings. | integration (approval) |
| AC-CI-47 | The ingest path shall make no LLM call and store no token or environment value. | unit |
| AC-CI-48 | If GitHub fails for one installation during sync, then the server shall process the others and list the failure in `errors`. | integration (approval) |
| AC-CI-49 | When the client opens CI Runs or the CI tab, it shall call sync with `mode='auto'`, and the server shall sync only installations whose `last_synced_at` is null or older than 10 minutes. | integration (approval) |
| AC-CI-50 | The sidebar GLOBAL section (created by A) shall show a "CI Runs" item linking to `/ci-runs`. | unit |
| AC-CI-51 | The CI Runs page shall list runs newest first with repository, PR number, agent, verdict, findings, cost, duration, short commit SHA and a link to the Actions job. | unit |
| AC-CI-52 | While there are no CI runs, the page shall show an empty state with a link to Agents. | unit |
| AC-CI-53 | While loading, the page shall show a loading state; if the request fails, it shall show the error with Retry. | unit |
| AC-CI-54 | If a run's cost is null, then the page shall show "—". | unit |
| AC-CI-55 | While every installation's `last_synced_at` is within 10 minutes, an automatic sync shall make zero GitHub calls and report them as `throttled`. | integration (approval) |
| AC-CI-56 | If a manual sync for an installation is requested within 60 s of its previous manual sync, then the server shall make no GitHub call and report it as `throttled`. | integration (approval) |
| AC-CI-57 | When the user clicks "Sync" on CI Runs (all installations) or on a CI-tab row (that installation), the client shall call sync with `mode='manual'` and refresh runs and installations. | unit |
| AC-CI-58 | When a run is ingested, the server shall set the installation `status='active'`; if sync fails with GitHub auth or 404, then it shall set `status='error'`. | integration (approval) |
| AC-CI-60 | The agent editor shall show a "CI" tab selectable via `?tab=ci`. | unit |
| AC-CI-61 | The CI tab shall show "CI deployment" and, while N ≥ 1 installations are `active`, the badge "Active in N repos". | unit |
| AC-CI-62 | The CI tab shall list each installation with repo, "GitHub Actions", installation status, last run status and relative time, or "No runs yet". | unit |
| AC-CI-63 | When the user clicks "+ Add repository", the client shall open the wizard with the repo picker defaulting to the active repo. | unit |
| AC-CI-64 | When the user clicks "Update CI config", the client shall open the wizard prefilled with the installation's repo and target and default Configure options. | unit |
| AC-CI-65 | When the user changes "Fail CI on", the client shall save `ci_fail_on` via the existing agent PATCH and state that CI picks it up after "Update CI config". | unit |
| AC-CI-66 | Each installation row shall show "workflow version v<agent_version>" and mark it outdated when it differs from the agent's current version. | unit |
| AC-CI-67 | Each installation row shall link to CI Runs filtered by agent and repo. | unit |
| AC-CI-70 | When grounded findings meet the manifest's `ci_fail_on`, the runner shall exit 1 so the check fails (existing, `run.ts:161`). | unit (agent-runner) + manual |
| AC-CI-71 | When the check is required and the runner exits 1, GitHub shall block merge (target-repo configuration). | manual |
| AC-CI-75 | The ci module shall expose no endpoint that returns a secret value. | unit |
| AC-CI-76 | The client shall render ingested PR titles, branch names and artifact strings as text only. | unit |
| AC-CI-77 | The ci module's GitHub calls shall go through `container.github` so tests use mocks. | unit |
| AC-CI-78 | The workflow shall check out `github.event.pull_request.base.sha` and skip the review with a notice when `.devdigest/runner/index.js` is absent in that checkout. | unit |
| AC-CI-79 | While GitHub review is selected, the Configure step shall note that the target repo must allow GitHub Actions to create pull request reviews. | unit |
| AC-CI-80 | If `base` is not given, then the server shall use the target repo's default branch from GitHub. | integration (approval) |
| AC-CI-81 | When the runner writes `devdigest-result.json`, it shall include `model`, `manifest_version`, `gate_triggered` and `blockers`, and the artifact shall still validate against `CiResultArtifact`. | unit (agent-runner) |
| AC-CI-82 | The CI Runs page shall show at most the 50 newest runs, accept optional `agent_id` and `repo` URL query filters (also applied by `GET /ci/runs`), and show no header statistics or pagination. | unit + integration (approval) |
| AC-CI-83 | If the edited workflow exceeds 64 KB (65 536 bytes UTF-8), then the server shall respond 422 and the Preview step shall show the limit and keep Continue disabled. | unit |
| AC-CI-84 | The Install step shall show "Need help?" linking to https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions, opened in a new tab with `rel="noopener noreferrer"`. | unit |
| AC-CI-85 | When the feature is verified, the implementer shall record the observed preview latency, export latency and `agent-runner/dist/index.js` size in the verification notes; no threshold is enforced. | manual |

## 13. Test scenarios
- T1 Wizard happy path with mocked hooks: Target → Preview (edit workflow) → Configure → Install (PR) → toast → AC-CI-01..07, 09, 11..15, 19, 79.
- T2 Wizard edge cases: preview 422, install 502, 409 other agent, regenerate prompt, close before install → AC-CI-05, 08, 10, 16, 18.
- T3 Generator unit tests: manifest round-trip (`JSON.parse` + `AgentManifest`), model mapping, slug rules, workflow string assertions (no `pull_request_target`, permissions, SHA regex, env names, fork guard, base-SHA checkout, upload step, no untrusted `${{ }}` in `run:`), bundle missing → AC-CI-20..29, 35, 38, 78.
- T4 `ci-export.it.test.ts` with mock GitHub: new install, re-export same agent, 409 other agent, reuse PR, default branch, zip install row, scoping, GitHub failure → AC-CI-30..34, 36, 37, 39, 80.
- T5 `ci-ingest.it.test.ts` with mock runs/artifacts (fflate fixtures) and a fake clock: valid, invalid, PR mismatch, foreign workflow, duplicate, missing artifact, partial failure, auto throttle (assert zero mock calls), manual throttle, status transitions → AC-CI-40..49, 55, 56, 58.
- T6 CI Runs page and CI tab component tests → AC-CI-50..54, 57, 60..67, 76.
- T7 agent-runner tests: gate exit code, extended artifact → AC-CI-70, 81.
- T8 Manual end-to-end on a real repo (paid LLM in the user's Actions; approval): export → PR on `devdigest/ci` → review permissions/triggers → add `OPENROUTER_API_KEY` → merge → mark check required → test PR with a CRITICAL issue → PR comment posted, check red, merge blocked → Sync → run in CI Runs with repo, PR, SHA → AC-CI-30, 70, 71, 40, 45, 51.
- Verification commands (sequential): `cd server && pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm exec vitest run .it.test` (Docker); `cd client && pnpm typecheck && pnpm test`; `cd agent-runner && pnpm run typecheck && pnpm test`; `cd server && pnpm verify:l06`. No paid LLM and no real GitHub calls in tests.

## 14. Assumptions (to be confirmed)
- A3. Target repo must be a repo connected in the current workspace (`repos.full_name`, `server/src/db/schema/repos.ts:14`).
- A4. The studio's GitHub token has repo write + workflow-file permission; otherwise install fails with the GitHub reason.
- A5. With `post_as='none'` the workflow uses `pull-requests: read` (still needed to fetch the diff).
- A7. Verdict shown on CI Runs: `gate_triggered` → "Blocked", artifact without gate → "Passed", no artifact → "Failed".
- A8. `status='error'` is set only on GitHub auth/404 sync failures and cleared to `active` on the next successful ingest (confirmed, user 2026-10-23; AC-CI-58).
- (A1, A2, A6 from v1 are now decisions or covered by shared section S.2.)

## 15. Decisions and open questions
Decision (user, 2026-10-23):
- Q1 ingest → studio pulls Actions artifacts; manual Sync (rate-limited) + throttled automatic sync on page open (10 min), no polling loop.
- Q2 storage → `agent_runs(source='ci')` + `ci_runs` via `agent_run_id` (S.3). Q3 migration → shared 0016 per S.1/S.2, not created by B.
- Q4 omit `memory.jsonl`. Q5 read built `agent-runner/dist/index.js`, clear error if missing. Q6 default post_as = PR comment. Q7 static secret badges. Q8 disabled non-GHA cards. Q9 repo picker defaulting to active repo. Q10 warn + regenerate. Q11 workflow only editable. Q12 base-SHA checkout. Q13 one agent per repo as temporary MVP rule: same agent → update; other agent → 409 `ci_repo_has_agent`. Q14 `<provider>/<model>` mapping shown in Preview. Q15 see Q1. Q16 counts only. Q17 artifact + manifest extension approved; dependencies = runner version + skill slugs. Q18 workflow version = `agent_version`. Q19 wizard prefilled. Q21 A creates GLOBAL, B adds "CI Runs" after rebase. Q22 JSON-compatible YAML. Q23 repo default branch. Q25 skip forks. Q27 zip creates a `pending` installation.
- Q20 CI Runs layout → columns in AC-CI-51 order, newest 50 rows, `agent_id`/`repo` URL filters, no header stats, no pagination (AC-CI-82).
- Q24 edited-workflow limit → 64 KB, 422 above (AC-CI-83).
- Q26 performance → no target; measure and record (AC-CI-85). Sync limits 10 min / 60 s / 20 runs confirmed.
- Q28 help link → GitHub Docs "Using secrets in GitHub Actions" (AC-CI-84).
- A8 installation `error` status rule confirmed (AC-CI-58).

Open questions: none (§19.2).

## 16. Approvals required
- Migration 0016 (S.2), created in the pre-fan-out prep commit (S.1), not by worktree B — needs explicit user approval before `pnpm db:generate`.
- Contract changes in both `vendor/shared` copies (§6.2); agent-runner change + rebuild (AC-CI-81).
- No new dependencies.
- `.it.test.ts` runs need Docker; manual T8 makes paid OpenRouter calls in the target repo and real GitHub writes.

## 17. File ownership and merge order
Per shared section S.4 / S.5. Schema and migration 0016 (S.2) come from the pre-fan-out prep commit (S.1), not from worktree B. B rebases on A after A merges; expected conflicts only in `nav.ts`, `shell.json`, `modules/index.ts`; B re-runs §13 commands before merging.

## Shared with the sibling spec (L07 worktrees A + B) — identical in both specs

This section is copied verbatim into `specs/multi-agent-review.md` (A) and `specs/export-to-ci.md` (B). Change it in both files or in neither.

### S.1 Pre-fan-out preparation commit (on the base branch, BEFORE `git worktree add`)
One commit, made only after explicit user approval, containing exactly:
1. `server/src/db/schema/runs.ts` and `server/src/db/schema/ci.ts` changes listed in S.2.
2. The generated migration `server/src/db/migrations/0016_<drizzle-name>.sql` + `meta/0016_snapshot.json` + `meta/_journal.json` (via `pnpm db:generate`; never hand-written).
3. Both specs.
Neither worktree creates or edits a migration. A worktree that needs another schema change stops and asks.

### S.2 Migration 0016 — exact schema delta (described, NOT yet created)
`agent_runs` (`server/src/db/schema/runs.ts`):
- `multi_agent_run_id uuid NULL` → FK `multi_agent_runs.id` ON DELETE SET NULL; index `agent_runs_multi_agent_run_id_idx`. Set by A for runs started with `agentIds`; NULL for single/`all` runs and for CI runs.
- (no other new columns; CI runs use the existing `source` = `'ci'`, `agent_id`, `status`, `findings_count`, `score`, `blockers`, `duration_ms`, `model`, `provider`; `pr_id` stays NULL when the PR is not imported into the studio.)

`ci_installations` (`server/src/db/schema/ci.ts`):
- `status text NOT NULL DEFAULT 'pending'` — `pending` (export PR opened) | `active` (≥1 ingested run) | `error`.
- `agent_version integer NULL` — agent version at export time (shown as "workflow version").
- `pr_url text NULL` — the export PR on `devdigest/ci`.
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- `last_synced_at timestamptz NULL` — throttles automatic ingest (B, §ingest).
- unique index `ci_installations_agent_repo_target_uq` on (`agent_id`, `repo`, `target_type`). Deliberately NOT unique on (`repo`) alone: the DB already allows several agents per repo; the one-agent-per-repo rule is an MVP rule in the service + runner only.

`ci_runs` (`server/src/db/schema/ci.ts`):
- `agent_run_id uuid NULL` → FK `agent_runs.id` ON DELETE CASCADE; unique index `ci_runs_agent_run_id_uq`.
- `commit_sha text NULL`, `github_run_id bigint NULL`, `github_repo_id bigint NULL`.
- unique index `ci_runs_installation_github_run_uq` on (`ci_installation_id`, `github_run_id`) — idempotent ingest.

`multi_agent_runs`: unchanged.

### S.3 Attribution model
- Every review result, local or CI, is an `agent_runs` row attributed to its agent via `agent_id`; findings stay attributed through `reviews.run_id` / `reviews.agent_id` → `findings.review_id`.
- A (multi-agent): `agent_runs.multi_agent_run_id` groups child runs; findings are never copied or rewritten — grouping is computed on read.
- B (CI): one ingested GitHub Actions run = one `agent_runs` row (`source='ci'`, `agent_id` from the installation) + one `ci_runs` row (`agent_run_id`, `ci_installation_id`, `github_run_id`, `commit_sha`, `github_repo_id`, `pr_number`, `github_url`). "Ingest reads A's attribution" means: B relies on the `agent_runs` attribution columns and read paths as they exist after A merges (A must not rename/remove `agent_id`/`source`), and B's CI rows must render correctly in any agent_runs-based view A adds (they have `multi_agent_run_id = NULL`).

### S.4 File ownership
| Area | Owner | Notes |
|---|---|---|
| `server/src/modules/reviews/**` (multi-run service, executor, routes), PR page `client/src/app/repos/[repoId]/pulls/**`, Multi-Agent Review pages, `observability.ts` contracts (both copies), `platform.ts` `RunRequest` (both copies) | A | B must not touch |
| `server/src/modules/ci/**`, `agent-runner/**`, agent CI tab, CI Runs page, `eval-ci.ts` contracts (both copies), new `GitHubClient` methods in `server/src/vendor/shared/adapters.ts` + `server/src/adapters/github/octokit.ts` + `server/src/adapters/mocks.ts` | B | A must not touch |
| `client/src/vendor/ui/nav.ts` + `client/messages/en/shell.json` | A creates the GLOBAL section with the "Multi-Agent Review" item; B adds only the "CI Runs" item to that section after rebasing on A | expected, trivial conflict |
| `server/src/modules/index.ts` | A only if it adds a module; B adds the `ci` module registration | one-line additions |
| `server/src/db/**` | prep commit only (S.1) | nobody in A/B |

### S.5 Merge order
1. Prep commit (S.1) on the base branch → create both worktrees from it.
2. Merge A first; run its checks on the merged base.
3. Rebase B onto the new base; resolve only the expected conflicts (`nav.ts`, `shell.json`, `modules/index.ts`); re-run B's checks; merge B.
4. Full product check after both merges.

## 19. Mockup coverage
### 19.1 Coverage table
| Element | Screenshot # | AC-IDs | Status | Note |
|---|---|---|---|---|
| Sidebar "CI Runs" item | 1 | AC-CI-50 | Covered | In A's GLOBAL section, added after rebase |
| Sidebar Memory / Multi-Agent Review / Agent Performance | 1 | — | Out of scope | Worktree A / other lessons |
| Agent tabs incl. "CI" | 1 | AC-CI-60 | Covered | |
| Agent "Stats" tab | 1 | — | Out of scope | |
| "Run Review" button | 1 | — | Out of scope | Existing agent page |
| "CI deployment" title + "Active in N repos" | 1 | AC-CI-61 | Covered | |
| "Update CI config" button | 1 | AC-CI-64 | Covered | Wizard prefilled |
| "+ Add to CI" button | 1 | AC-CI-01 | Covered | |
| Installation row: repo, "GitHub Actions" | 1 | AC-CI-62 | Covered | |
| Installation row: status badge + relative time | 1 | AC-CI-62, 58 | Covered | |
| "+ Add repository" | 1 | AC-CI-01, 63 | Covered | |
| Fail CI on / workflow version / history / per-row Sync (lab text) | 1 | AC-CI-65, 66, 67, 57 | Covered | |
| Modal title, subtitle, × close | 2 | AC-CI-01, 18 | Covered | |
| Stepper Target/Preview/Configure/Install | 2-5 | AC-CI-02 | Covered | |
| GitHub Actions card + "recommended" | 2 | AC-CI-03 | Covered | |
| CircleCI / Jenkins / Generic CLI cards | 2 | AC-CI-04 | Covered | Disabled, "Not available yet" |
| Repo picker (absent in mockup) | 2 | AC-CI-05 | Covered | Added element |
| Continue (step 1) | 2 | AC-CI-05 | Covered | |
| "FILES TO CREATE" list | 3 | AC-CI-06, 20 | Covered | |
| `.devdigest/agents/<slug>.yaml` | 3 | AC-CI-21, 22 | Covered | JSON-compatible YAML |
| `.devdigest/skills/*.md` | 3 | AC-CI-20, 22 | Covered | |
| `.devdigest/memory.jsonl` | 3 | — | Out of scope | Runner does not read it (Q4 decision) |
| `.devdigest/runner/index.js` (absent in mockup) | 3 | AC-CI-26, 38 | Covered | Added element |
| `.github/workflows/devdigest-review.yml` + "editable" | 3 | AC-CI-07, 23-29, 78 | Covered | |
| Workflow body `uses: devdigest/review-action@v1`, `OPENAI_API_KEY` | 3 | AC-CI-25, 26 | Placeholder | Replaced by bundled runner + OPENROUTER_API_KEY |
| Back / Continue (steps 2-4) | 3-5 | AC-CI-07, 18 | Covered | |
| Trigger chips opened/synchronize/reopened | 4 | AC-CI-09 | Covered | |
| Secrets expected rows + hint | 4 | AC-CI-11 | Covered | |
| Secret badges "not set" / "ready" | 4 | AC-CI-11 | Covered | Replaced by static "required" / "auto-provided" |
| "Post results as" radios + recommended | 4 | AC-CI-12, 79 | Covered | PR comment preselected (differs from mockup) |
| Info box Fail CI on + required status check | 4 | AC-CI-13 | Covered | |
| "Open a PR with these files" + text (repo, N files) | 5 | AC-CI-14, 30, 36 | Covered | N = real count |
| "Copy files as a zip" | 5 | AC-CI-14, 17, 39 | Covered | |
| "Need help? See the GitHub Action setup docs →" | 5 | AC-CI-84 | Covered | Q28 decision: GitHub Docs secrets page |
| Install button + success/failure | 5 | AC-CI-15, 16, 19 | Covered | |
| CI Runs: columns repo/PR/agent/verdict/findings/cost/duration/SHA/job link | none | AC-CI-51, 54, 82 | Covered | Q20 decision |
| CI Runs: empty state | none | AC-CI-52 | Covered | Design artboard exists, not inspected |
| CI Runs: loading/error | none | AC-CI-53 | Covered | |
| CI Runs: Sync button + auto sync | none | AC-CI-49, 55-57 | Covered | |
| CI Runs: filters, pagination, header stats | none | AC-CI-82 | Covered | Q20 decision: URL filters, 50 rows, no pagination, no header stats |

### 19.2 Open questions ([NEEDS CLARIFICATION] index)
None. Q20, Q24, Q26, Q28 and A8 were decided by the user on 2026-10-23 (see §15; AC-CI-82…85, AC-CI-58).
