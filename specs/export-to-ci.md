# Spec: L07 worktree B — Export agent to CI (GitHub Actions) + CI Runs

- **Key:** CI · **Status:** Approved (v4) — P0: current state synced to prep commit 5eee208; G1–G5, TA1–TA4 and Q29 (= A) decided, no open questions · **Date:** 2026-10-23 · **Packages:** server | client | contracts | agent-runner (reviewer-core: read-only reuse)
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
- Removing a CI installation — neither a DB-only removal nor a safe removal together with its GitHub files (manifest, skills, runner, workflow). Deleting an agent removes its `ci_installations` rows (FK cascade) but never touches the target repo: the files stay there until someone removes them by hand (§6.4).
- Deleting, renaming or rewriting any file in the target repo that the export does not own (§8 "Manifest path and file safety").
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
- Contracts (server copy, `server/src/vendor/shared/contracts/eval-ci.ts`): `CiTarget` :133, `CiFile` :137 (`editable` default true), `AgentManifest` :152-168 (no `post_as`, no version), `CiExportInput` :174-182 (`base` default `'main'`, `post_as` default `github_review`, triggers default all three), `CiInstallation` :188-194 (only `id, agent_id, repo, target_type, installed_at` — none of the 0016 columns), `CiExport` :198 (`pr_url`), `CiRunStatus` :205 (`succeeded|failed|no_findings|running`), `CiRun` :209-221, `CiResultArtifact` :228-238 (counts only, no SHA, no model, no skills). The client copy (`client/src/vendor/shared/contracts/eval-ci.ts`) has the same schemas at :133-199 but **no `AgentManifest`** (and no `CiFailOn` import there). No contract exists yet for the preview response, the sync input/result, an installation with agent name / last run, or the `ci_*` error codes.
- Tables (after migration 0016, S.2): `ci_installations` (`server/src/db/schema/ci.ts:14-42`) = `agent_id, repo, target_type, installed_at` + `status` (pending|active|error, default pending), `agent_version`, `pr_url`, `updated_at`, `last_synced_at`, unique (`agent_id`, `repo`, `target_type`); **no `workspace_id`** (scope through `agents.workspace_id`) and **no manifest-path column**. `ci_runs` (`ci.ts:44-72`) = `ci_installation_id` (FK SET NULL), `pr_number, ran_at, status, findings_count, cost_usd, github_url, source` + `agent_run_id` (FK CASCADE, unique), `commit_sha`, `github_run_id`, `github_repo_id`, unique (`ci_installation_id`, `github_run_id`). Both tables are unused by any module.
- `agent_runs.source` enum `local|ci` default `local` (`server/src/db/schema/runs.ts:26`), `prId` nullable FK, `blockers` (:32), `multi_agent_run_id` (:34-38, from 0016; NULL for CI runs); trace in `run_traces` jsonb (:42-47). Run cost is read from the trace (`traceCostUsd()` reads `trace.stats.cost_usd`, `server/src/db/trace-cost.ts:16`). Stored traces are read back without parsing (`server/src/modules/reviews/repository/run.repo.ts:193`, cast `as RunTrace`).
- `agents.ci_fail_on` (`server/src/db/schema/agents.ts:25`), `agents.version` (:33); `ci_fail_on` is saved through `PUT /agents/:id` (`server/src/modules/agents/routes.ts:111-120`; client `useUpdateAgent` → `api.put`, `client/src/lib/hooks/agents.ts:64`). A config change (incl. name and `ci_fail_on`) bumps `version` and snapshots `agent_versions.config_json` — the snapshot has **no `name`** (`server/src/modules/agents/repository.ts:163-206`), so an old agent name (slug) cannot be recovered from the DB. Skills have `name`, `version`, no slug column (`server/src/db/schema/skills.ts:10,18`).
- Latest migration `server/src/db/migrations/0016_l07_multi_agent_ci.sql` (prep commit 5eee208, S.1/S.2); B adds none.
- `GitHubClient` has `openPullRequest`, `commitFiles`, `findOpenPr` (`server/src/vendor/shared/adapters.ts:155-163`); octokit impl `server/src/adapters/github/octokit.ts:245,264,332`. `commitFiles` makes one commit on top of the target branch if it exists, else on the base (`:275-284`, any `getRef` error counts as "branch missing"), and force-updates an existing branch (`:309-316`); it can only add/overwrite files, **never delete** them. Mocks `server/src/adapters/mocks.ts:218-228`. No workflow-run / artifact / default-branch / directory-listing methods.
- Server has `fflate` (`server/package.json:32`, used in `server/src/modules/skills/import/zip.ts:2`); no direct YAML dependency. `verify:l06` script `server/package.json:16`.
- agent-runner: exactly one `.devdigest/agents/*.yaml` or it fails (`agent-runner/src/manifest.ts:40-44`); `DEVDIGEST_POST_AS` default `github_review` (`agent-runner/src/index.ts:25-28,33`); always `OpenRouterProvider` (:39); `GITHUB_TOKEN` required unless `none` (`agent-runner/src/run.ts:100-102`); diff fetched via API and `.devdigest/**` stripped (:108-109); artifact written before posting (:149); exit 1 iff gate triggered (:161) **or** hard failure with no artifact and nothing posted (:171). Artifact fields `agent-runner/src/artifact.ts:34-44`, `RUNNER_VERSION='1'` (:6). Fork flag informational only (`agent-runner/src/context.ts:30-31`). The runner does not read `.devdigest/memory.jsonl`. `dist/` is gitignored (`agent-runner/README.md:80`).
- agent-runner loads skill files only for the slugs listed in the manifest (`agent-runner/src/skills.ts:24-38`), so a stale `.devdigest/skills/*.md` file is harmless; a second manifest is not (`manifest.ts:40-44`).
- Client: `ExportWizardSteps({ step, labels })` (`client/src/vendor/ui/ExportWizardSteps.tsx:6`), unused. `Modal` closes on × / backdrop but has no Esc handling (`client/src/vendor/ui/kit/Modal.tsx`). Agent editor tabs: config/skills/context/evals (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:13-16`); `AgentEditor.test.tsx:88-93` currently asserts there is **no** CI tab (B updates it). Sidebar `NAV` has WORKSPACE and SKILLS LAB only in this branch (`client/src/vendor/ui/nav.ts:21-41`; A adds GLOBAL).
- Existing i18n: `client/messages/en/ci.json` already exists (top-level keys `runs`, `exportWizard`, `ciTab`, `publishDialog`, `page`) with older copy that contradicts this spec — e.g. `exportWizard.blockMergeDesc` "Requires a GitHub App — not available with PAT in local mode" (vs AC-CI-13) and `ciTab.heading` "Continuous Integration" (vs "CI deployment", AC-CI-61); B rewrites the affected keys, it does not create the file. `agents.json` `editor.tabs.ci` = "CI" and `shell.json` `nav.ci-runs` = "CI Runs" already exist; the active-nav mapping for `/ci-runs` exists (`client/src/components/app-shell/helpers.ts:38`).

## 5. Inputs and provenance
| Input | Source | Trust | Validation / limits |
|---|---|---|---|
| Agent config (name, model, provider, system_prompt, strategy, ci_fail_on, version) | DB, workspace-scoped | trusted (user-authored) | Must serialize to a valid `AgentManifest` |
| Linked enabled skills (name, body, order) | DB | trusted | Slug collision → 422 |
| `repo` (`owner/name`) | wizard picker (workspace repos) | user input | `owner/name`; connected workspace repo |
| `triggers`, `post_as`, `target`, `base`, `action` | wizard | user input | `CiExportInput` Zod; triggers ⊆ {opened, synchronize, reopened}, ≥1; `base` optional (default = repo default branch) |
| Edited workflow text | wizard Preview | user input | ≤ 64 KB (Q24 decision, AC-CI-83); must not contain `pull_request_target` |
| Runner bundle | `agent-runner/dist/index.js` read at export time | trusted build output | Missing → error naming `cd agent-runner && pnpm build` |
| Existing files under `.devdigest/agents/`, `.devdigest/skills/`, `.devdigest/runner/` and `.github/workflows/` in the target repo (base branch and `devdigest/ci`) | GitHub API, studio token, read at fixed commit SHAs | **untrusted** | Only listed and, for agent manifests, YAML-parsed + `AgentManifest.safeParse`d to read `agent_id`/`skills`; never executed or rendered as HTML |
| Workflow run metadata (run id, head SHA, repo id, PR number, conclusion, html_url) | GitHub API, studio token | GitHub-asserted | Must match installation repo + workflow path |
| `devdigest-result.json` | Actions artifact | **untrusted** | `CiResultArtifact.safeParse`; numbers ≥ 0; PR number cross-checked |
| PR title / body / branch names | GitHub | **untrusted** | Rendered as text only; never interpolated into workflow `run:` |
| `OPENROUTER_API_KEY`, `GITHUB_TOKEN` | GitHub Actions secrets | secret | Referenced only as `${{ secrets.X }}`; never read by the studio |

## 6. Outputs (contracts, UI, persistence, trace)
### 6.1 API (owned by B; names proposed)
- `POST /agents/:id/ci/preview` body `CiExportInput` → `CiPreview` (`{ files: CiFile[] }`). No writes. Runs the read-only repo inspection of §8 so the previewed paths (incl. a kept manifest path) are the ones Install will write; a conflict is reported here already (409).
- `POST /agents/:id/export-ci` body `CiExportInput` (its optional `files` overrides the workflow file only) → `CiExport` (`pr_url` set for `open_pr`). Same agent + repo → update; another agent's installation on the repo → 409 `ci_repo_has_agent` (G2).
- `POST /agents/:id/export-ci/zip` same body → `application/zip` (server-side `fflate`); also upserts the installation (`pending`). Runs the same read-only repo inspection as preview (§8), so the zip carries the kept manifest path and is refused on the same conflicts; it writes nothing to GitHub.
- `GET /agents/:id/ci/installations` → `CiInstallationView[]` of that agent.
- `GET /ci/installations?repo=owner/name` → `CiInstallationView[]` of every agent in the workspace installed on that repo (G4; used by the wizard's occupied-repo warning, AC-CI-05, AC-CI-86).
- `GET /ci/runs` → `CiRun[]` (+ repo, verdict, commit_sha, agent name), newest first, workspace-scoped; optional `agent_id`, `repo` filters (used by CI tab history links).
- `POST /ci/runs/sync` body `CiSyncInput` (`{ mode: 'auto' | 'manual', installation_id?: uuid }`) → `CiSyncResult`.
- Error codes (`CiErrorCode`, G4): `ci_repo_has_agent` (409), `ci_manifest_conflict` (409, AC-CI-89), `ci_file_conflict` (409, AC-CI-90), `ci_concurrent_change` (409, AC-CI-91), `ci_runner_bundle_missing` (AC-CI-38); validation failures stay 422. Every 409 names the agent or files concerned and means nothing was written.
- New `GitHubClient` methods (+ octokit + mocks; names proposed): default branch of a repo; head commit SHA of a branch (null when missing); list one directory at a commit SHA (missing directory → empty list); read one file at a commit SHA; **commit files only if the branch head is still the expected SHA** (create the branch at the expected base SHA when it must not exist yet; update it without force otherwise; a moved or newly created ref → a distinct "ref changed" error); list workflow runs for a workflow file; list run artifacts; download an artifact zip. The existing force-updating `commitFiles` stays unchanged and is not used by the ci module.
### 6.2 Contracts (both vendored copies change identically)
- Client copy: add `AgentManifest` (+ `CiFailOn` import) to match the server.
- `AgentManifest`: optional `version` (agent version at export) and optional `agent_id` (the studio agent's uuid; proves which agent owns a manifest found in the repo, §8). The runner needs no change for `agent_id`: it validates with the same schema and ignores the value.
- `CiExportInput`: add optional `files`; `base` optional (no `'main'` default); `post_as` default `pr_comment`.
- `CiInstallation`: add `status`, `agent_version`, `pr_url`, `updated_at`, `last_synced_at`.
- `CiRun`: add `repo`, `commit_sha`, `verdict`, `agent_run_id`.
- `CiResultArtifact`: optional `model`, `manifest_version`, `gate_triggered`, `blockers`, `skills` (manifest skill slugs, G3). All additions nullish → older bundles still validate.
- New (G4): `CiInstallationView` = `CiInstallation` + `agent_name`, `last_run_status` (nullable), `last_run_at` (nullable); `CiPreview` = `{ files: CiFile[] }`; `CiSyncInput` = `{ mode: 'auto' | 'manual', installation_id?: uuid }`; `CiSyncResult` = `{ ingested: int, throttled: int, skipped: { installation_id, github_run_id: number | null, reason }[], errors: { installation_id, repo, message }[] }`; `CiErrorCode` = `z.enum(['ci_repo_has_agent', 'ci_manifest_conflict', 'ci_file_conflict', 'ci_concurrent_change', 'ci_runner_bundle_missing'])`.
- agent-runner writes the new artifact fields (rebuild required).
### 6.3 UI (client)
- **Agent CI tab** (`?tab=ci`): header "CI deployment" + badge "Active in N repos"; buttons "Update CI config", "+ Add to CI"; installation rows (repo, "GitHub Actions", status badge pending/active/error, last run status + relative time, workflow version = `agent_version`, link to PR while pending, "Sync" button, "History" link); "+ Add repository"; "Fail CI on" select (never/critical/warning/any) with a note that the repo copy changes only after "Update CI config". States: loading, empty ("Not deployed to CI yet" + "+ Add to CI"), error + Retry.
- **Wizard modal** "Export to CI — Run <agent> automatically on pull requests", stepper via `ExportWizardSteps`. Close (×/Esc) discards state; nothing is written before Install.
  - Step 1 Target: repo picker (workspace repos, default = active repo); cards GitHub Actions (selected, "recommended", "Runs on pull_request events"), CircleCI / Jenkins / Generic CLI disabled with "Not available yet". If the chosen repo already has another agent installed, an inline warning names it and Continue is disabled.
  - Step 2 Preview: "FILES TO CREATE" + right pane; only the workflow is editable ("editable" tag); manifest shows the resolved OpenRouter model id. Loading, error + Retry.
  - Step 3 Configure: trigger chips (opened on, synchronize on, reopened off); "Secrets expected" OPENROUTER_API_KEY / GITHUB_TOKEN with static badges "required" / "auto-provided" and hint "Add these to your repo's Actions secrets before the workflow runs"; "Post results as" PR comment (preselected) / GitHub review (note: needs the repo setting that lets Actions create PR reviews) / None (exit code only); info box: Fail CI on + required status check in branch protection/ruleset. If the workflow was edited, changing an option asks "Regenerate workflow? Your edits will be lost" (cancel keeps the previous option).
  - Step 4 Install: "Open a PR with these files" (default; "DevDigest opens a PR in <repo> titled 'Add DevDigest CI review' with the N generated files"; for an existing installation "Update the existing PR") / "Copy files as a zip"; help link to GitHub Docs "Using secrets in GitHub Actions" (Q28, AC-CI-84); Install disabled while pending. Success → toast with PR link, modal closes, CI tab refreshes. Failure → inline error, Install re-enabled.
- **CI Runs page** `/ci-runs`, item "CI Runs" in the GLOBAL sidebar section created by A: table repository, PR (#n), agent, verdict (Blocked / Passed / Failed), findings, cost (`—` when null), duration, short commit SHA, "View job" link; Sync button; loading / empty (CTA to Agents) / error states. Layout per Q20 decision (AC-CI-82): columns in AC-CI-51 order, newest 50 rows, `agent_id`/`repo` filters only via URL query, no header stats, no pagination in the MVP.
### 6.4 Persistence (migration 0016 (S.2), created in the pre-fan-out prep commit 5eee208 (S.1), not by worktree B; no further schema change)
- `ci_installations`: one row per (`agent_id`, `repo`, `target_type`) (unique `ci_installations_agent_repo_target_uq`); writes `status`, `agent_version`, `pr_url`, `updated_at`, `last_synced_at`.
  - Status transitions (G5): first export/zip → `pending`; re-export of a `pending` row → `pending`; re-export of an `active` row → stays `active` (the workflow already runs; only the PR is updated); re-export of an `error` row → `pending` (the GitHub write just succeeded); ≥1 ingested run → `active`; sync fails with GitHub auth/404 → `error`.
  - Occupancy (G2): a `pending`, `active` or `error` installation of an agent occupies the repo for every other agent (AC-CI-37). The MVP has no way to remove an installation (§2). The row disappears only when its agent is deleted (FK cascade); that does **not** clean the target repo — the old manifest, skills, runner and workflow stay there, so another agent's export is still refused with `ci_manifest_conflict` / `ci_file_conflict` (AC-CI-89, 90) until someone removes those files by hand.
  - `last_synced_at` = the time the last automatic sync claimed the installation (TA4), not "last successful sync".
- Per ingested CI run (S.3): `agent_runs` (`source='ci'`, `agent_id` from the installation, `model`, `provider='openrouter'`, `status`, `findings_count`, `blockers`, `duration_ms`, `pr_id` NULL unless the PR is imported, `multi_agent_run_id` NULL) + `run_traces` + `ci_runs` (`agent_run_id`, `ci_installation_id`, `github_run_id`, `commit_sha`, `github_repo_id`, `pr_number`, `github_url`, `ran_at`, `status`, `findings_count`, `cost_usd`, `source='ci'`). Idempotency via unique (`ci_installation_id`, `github_run_id`).
### 6.5 Trace (per CI run)
`{ source: 'ci', manifest_version, model, dependencies: { runner_version, skills: [slugs] }, commit_sha, repo, github_repo_id, pr_number, github_run_id, github_run_url, cost_usd, severity counts, gate_triggered }`. No env values, no tokens.

Storage shape (TA2): the stored document is a valid `RunTrace` (`server/src/vendor/shared/contracts/trace.ts:131-147`) so existing readers (cast without parsing, `run.repo.ts:193`; `traceCostUsd()`; the trace drawer) work unchanged: `config = { agent: <agent name>, version: <manifest_version as string | null>, provider: 'openrouter', model, pr: pr_number, source: 'ci' }`, `stats = { duration_ms, tokens_in: 0, tokens_out: 0, findings: findings_count, grounding: 'ci', cost_usd }` (token counts are not reported by the artifact; 0 = not reported), `prompt_assembly = { system: '', user: '' }`, and empty `tool_calls`, `memory_pulled`, `specs_read`, `log`, `raw_output: ''`. The §6.5 fields above are stored in an extra top-level `ci` object (the server validates the document with `RunTrace.safeParse` and stores the original object, so `ci` is kept). `skills` comes from the artifact (G3) and is `null` when an older bundle did not write it.

## 7. Functional requirements
- FR-1 Wizard navigation and states → AC-CI-01..08, 18, 19.
- FR-2 Configure options → AC-CI-09..13, 79.
- FR-3 Manifest + skills generation → AC-CI-20..22.
- FR-4 Workflow generation. Exact files: `.devdigest/agents/<slug>.yaml` (JSON-compatible YAML), `.devdigest/skills/<skill-slug>.md` per enabled linked skill in order, `.devdigest/runner/index.js`, `.devdigest/runner/package.json` (exactly `{"type":"module"}`), `.github/workflows/devdigest-review.yml` → AC-CI-20, 23..29, 38, 78. The runner bundle is ESM (ncc output), so `.devdigest/runner/package.json` makes the runner directory an ES-module package; without it a target repo whose root `package.json` says `"type": "commonjs"` cannot load the runner.
- FR-5 Install via PR on `devdigest/ci`, update and one-agent-per-repo rule → AC-CI-14..16, 30..32, 36, 37, 80, 86, 89..91.
- FR-6 Zip download → AC-CI-17, 39.
- FR-7 Scoping and validation → AC-CI-33..35.
- FR-8 Gate/blocking → AC-CI-70, 71, 81.
- FR-9 Ingest by pulling Actions artifacts → AC-CI-40..49, 55..58, 87, 88.
- FR-10 CI Runs page + sidebar → AC-CI-50..54.
- FR-11 Agent CI tab → AC-CI-60..67.
- FR-12 Security invariants → AC-CI-75..78.

**Ingest design (decided: pull).** The workflow uploads `devdigest-result.json` via `actions/upload-artifact` (SHA-pinned). The studio, with its own GitHub token, lists completed runs of `devdigest-review.yml` per installation, downloads the `devdigest-result` artifact and unzips it with `fflate`. Authenticity = the GitHub API over the studio's token; commit SHA, repo id, PR number and URL come from the workflow-run object, not from the artifact; the artifact carries no secret. Rejected: push endpoint (the local studio on `localhost:3001` is unreachable from GitHub-hosted runners and it needs an extra secret or OIDC). Sync triggers: manual (rate-limited: one manual sync per installation per 60 s) and automatic on page open, only for installations whose `last_synced_at` is older than 10 minutes. No background loop. Each sync reads at most the 20 newest completed runs per installation.

**Completed runs without an artifact (G1).** Only conclusion `failure` or `timed_out` without a `devdigest-result` artifact is stored, as `failed` with null findings (a runner hard failure). Every other artifact-less run — `skipped` (fork guard, AC-CI-27), `cancelled`, `success` without artifact (runner absent in the base checkout, AC-CI-78), `neutral`, `stale`, `action_required` — is skipped with a reason and writes no row; it is re-read (and skipped again) by later syncs while it is among the 20 newest.

**Throttle and recovery (TA3, TA4).**
- Automatic sync first *claims* each due installation atomically: `UPDATE ci_installations SET last_synced_at = now() WHERE id = $1 AND (last_synced_at IS NULL OR last_synced_at < now() - interval '10 minutes') RETURNING last_synced_at`, remembering the previous value. Only a claimed installation is synced; two tabs opened together sync it once. No GitHub I/O runs inside a DB transaction.
- Recovery after a failure — a failed sync never blocks the next one for long:
  - transient GitHub failure (network, timeout, 429, 5xx): the claim is rolled back with a compare-and-set (`UPDATE … SET last_synced_at = <previous> WHERE id = $1 AND last_synced_at = <claimed>`), so the next page open retries; the installation status is unchanged;
  - GitHub auth/404 failure: the claim is kept (10-minute back-off against a token or repo that keeps failing) and the status becomes `error`;
  - process crash between claim and finish: nothing to roll back; the next automatic sync runs after at most 10 minutes;
  - in every case a manual sync is available at once: it ignores `last_synced_at` and is limited only by the in-process 60 s throttle (TA3); a successful manual sync sets `last_synced_at = now()`, a failed one leaves it unchanged.
- Partial progress is safe: each run is written in its own transaction and the unique (`ci_installation_id`, `github_run_id`) index skips runs already stored, so a retry ingests only what is missing (among the 20 newest).
- TA3: the manual 60 s throttle is an in-process `Map<installation_id, last manual sync time>` with an injected clock. It is lost on restart (at most one extra sync) and assumes the single API process this product runs; no schema change.

## 8. Constraints
- File ownership and merge order: shared section S.4 / S.5. B additionally owns `client/src/app/ci-runs/**`, the CI tab and wizard under `client/src/app/agents/[id]/_components/**`, `AgentEditor/constants.ts` tab entry, `client/src/lib/hooks/ci.ts`, `client/messages/en/ci.json`, `server/test/ci-*.test.ts`.
- B makes no change under `server/src/db/**` (schema and migration 0016 come from the prep commit); a further schema need → stop and ask.
- Forbidden: everything owned by A in S.4, `reviewer-core/**`, lockfiles, `package.json` deps.
- MVP: one agent per target repo, enforced in the service (runner reads exactly one manifest). Manifest path stays per-slug.
- G2 invariant: an export never leaves more than one `.devdigest/agents/*.yaml|*.yml` in the target repo. `pending`, `active` and `error` installations occupy the repo (AC-CI-37). A re-export of the same agent writes its manifest to the path it already has in the repo, even after the agent was renamed (AC-CI-89). The DB cannot store or derive that path (no path column; `agent_versions` has no name, §4); the target repo is the source of truth (Q29 = A), no migration.
- **Manifest path and file safety (Q29 = A).** Preview runs the occupancy check and steps 2–4 (read-only, no lock); zip runs steps 1–4 plus its DB upsert; open-PR export runs all steps.
  1. **Per-repo lock** (open-PR and zip export): an in-process lock keyed by `owner/name` serialises exports to one repo in this API process (single process, as TA3) from the occupancy check to the DB upsert. The occupancy check (another agent's `pending`/`active`/`error` installation → 409 `ci_repo_has_agent`, AC-CI-37) runs first, before any GitHub call.
  2. **Snapshot:** resolve the base branch (`base` or the repo default branch, AC-CI-80) to its head SHA `B0`, and `devdigest/ci` to `H0` (null when missing). Every later read uses these SHAs, never branch names.
  3. **Inspect** (target and working branch): list `.devdigest/agents/`, `.devdigest/skills/`, `.devdigest/runner/` and `.github/workflows/` at `B0` and at `H0`. `M` = the union of `*.yaml|*.yml` paths under `.devdigest/agents/`. A manifest is **owned** by this agent when every copy of it (at `B0` and/or `H0`) parses as YAML into a valid `AgentManifest` whose `agent_id` equals this agent's id.
  4. **Decide** the manifest path and the files this agent may overwrite (`K`):
     - `M` empty → manifest path `.devdigest/agents/<current-slug>.yaml`; `K` = ∅.
     - `M` = {m} and m is owned → manifest path m (kept even after a rename); `K` = {m, `.devdigest/runner/index.js`, `.devdigest/runner/package.json`, `.github/workflows/devdigest-review.yml`} ∪ {`.devdigest/skills/<s>.md` for each slug s in the owned manifest's `skills`}.
     - otherwise (a manifest that is not owned — foreign, hand-written, from a deleted agent, unparsable — or more than one) → 409 `ci_manifest_conflict` naming the files; nothing is written.
     - Every file the export would write that already exists at `B0` or `H0` must be in `K`; otherwise → 409 `ci_file_conflict` naming those paths (e.g. a hand-written `devdigest-review.yml`, or a skill slug newly linked to the agent whose `.md` already exists and is not listed in the owned manifest). Unknown files are never overwritten.
     - The export only adds or overwrites files in `K` ∪ (new paths); it never deletes or renames anything. Skill files no longer listed in the manifest stay in the repo and are harmless (the runner loads only listed slugs, §4).
  5. **Compare-and-swap commit:** one commit with parent `H0` (or `B0` when `devdigest/ci` did not exist). If `H0` exists, the branch is updated without force and only if its head is still `H0`; if it did not exist, it is created at the new commit and must still not exist. If GitHub reports that the ref moved or already exists → 409 `ci_concurrent_change`; nothing else was written, the user retries and the new state is inspected again.
  6. PR (`findOpenPr ?? openPullRequest`) and DB upsert follow (AC-CI-30..32, 36). If they fail after the commit, the commit stays only on `devdigest/ci`, no installation row is written (AC-CI-34) and a retry finds the owned manifest there.
  - **Residual risk (documented, not prevented):** the studio never writes the base branch, so a manifest merged into the base *after* step 2 (e.g. by hand) can still end up next to ours when the `devdigest/ci` PR is merged. The runner then fails loudly ("exactly one agent manifest", `agent-runner/src/manifest.ts:40-44`) and the next export reports `ci_manifest_conflict`.
  - Cost: per preview/zip/export about 2 ref reads + up to 8 directory listings + 1–2 file reads; all go through `container.github` with the adapter's timeout and retry.
- TA1 runner bundle location: `AppConfig.ciRunnerBundlePath` from env `DEVDIGEST_RUNNER_BUNDLE` (absolute, or relative to the server's working directory like `DEVDIGEST_CLONE_DIR`, `server/src/platform/config.ts:66-68`); default `agent-runner/dist/index.js` resolved from the repository root (derived from the config module's own location, not from `process.cwd()`). Tests point it at a temporary fixture file. Reading the file is the only file-system access of the ci module.
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
| Different agent, repo has a pending/active/error installation | 409 `ci_repo_has_agent` naming the installed agent; nothing written | AC-CI-37 |
| Re-export after the agent was renamed | Manifest written to its existing (owned) path, no second manifest | AC-CI-89 |
| Repo holds a manifest not owned by this agent (foreign, hand-written, from a deleted agent, unparsable) or more than one | 409 `ci_manifest_conflict` naming the files; nothing written | AC-CI-89 |
| A file the export would write already exists and is not owned (e.g. hand-written workflow, colliding skill file) | 409 `ci_file_conflict` naming the paths; nothing written, nothing deleted | AC-CI-90 |
| `devdigest/ci` moved or was created by someone else between inspection and commit | 409 `ci_concurrent_change`; nothing written; retry re-inspects | AC-CI-91 |
| Two exports to the same repo at once in this API | Serialised by the per-repo lock; the second sees the first's result | AC-CI-91 |
| Workflow run failed / timed out without artifact (runner hard fail) | Stored as `failed`, findings null | AC-CI-46 |
| Run skipped / cancelled / succeeded without artifact (fork, runner absent) | Skipped with a reason, no row | AC-CI-46 |
| Transient GitHub failure during automatic sync | Claim rolled back; next page open retries; status unchanged | AC-CI-87 |
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
| AC-CI-05 | The Target step shall show a repo picker of workspace repos defaulting to the active repo, and enable Continue only when a repo is selected and no other agent has a `pending`, `active` or `error` installation there (read from `GET /ci/installations?repo=`); otherwise it shall name that agent in an inline warning. | unit |
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
| AC-CI-20 | When preview is requested, the server shall return exactly the FR-4 file set — including `.devdigest/runner/package.json` with `{"type":"module"}` — and no `memory.jsonl`, deterministically for the same agent version and input. | unit |
| AC-CI-21 | The generated manifest shall be JSON-compatible YAML that validates against `AgentManifest`, with name, `agent_id` = the agent's id, `version` = agent version, system_prompt, strategy, ci_fail_on, enabled skill slugs in link order, and model = `model` for openrouter agents or `<provider>/<model>` otherwise. | unit |
| AC-CI-22 | If the agent slug (kebab-case of the name) is empty or two skill slugs collide, then the server shall respond 422 naming the conflict. | unit |
| AC-CI-23 | The generated workflow shall trigger only on `pull_request` with the selected types and shall never contain `pull_request_target`. | unit |
| AC-CI-24 | The generated workflow shall declare `contents: read` and `pull-requests: write` (`read` when post_as is `none`) and no other scope. | unit |
| AC-CI-25 | Every `uses:` in the generated workflow shall reference a full 40-hex commit SHA, and none shall reference `devdigest/review-action`. | unit |
| AC-CI-26 | The generated workflow shall run `node .devdigest/runner/index.js` with `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `PR_NUMBER` and `DEVDIGEST_POST_AS` equal to the selected post_as, and `.devdigest/runner/index.js` shall be byte-equal to `agent-runner/dist/index.js`. | unit |
| AC-CI-27 | The generated workflow job shall be skipped when the PR head repository differs from the base repository (fork). | unit |
| AC-CI-28 | The workflow shall upload `devdigest-result.json` as artifact `devdigest-result` even when the review step fails, ignoring a missing file. | unit |
| AC-CI-29 | The generated files and API responses shall contain no secret values and shall not interpolate PR title, body or branch names into `run:` scripts. | unit |
| AC-CI-30 | When export runs with `action=open_pr`, the server shall commit all files in one commit to branch `devdigest/ci` (on top of its inspected head, or of the inspected base-branch head when the branch does not exist; AC-CI-91) and open a PR titled "Add DevDigest CI review", never committing to the base branch. | integration (approval) |
| AC-CI-31 | If an open PR from `devdigest/ci` already exists, then the server shall add the commit to that branch and return the existing PR URL. | integration (approval) |
| AC-CI-32 | When export or zip succeeds for a new (agent, repo, target), the server shall insert one `ci_installations` row with `status='pending'`, `agent_version`, `pr_url` (open_pr only). | integration (approval) |
| AC-CI-33 | If the agent id is not in the caller's workspace, then the ci endpoints shall respond 404; a non-uuid id shall get 422. | integration (approval) |
| AC-CI-34 | If a GitHub call fails during export, then the server shall return an `AppError` with the GitHub reason and create no installation row. | integration (approval) |
| AC-CI-35 | If `repo` is not `owner/name`, is not a workspace repo, or a trigger is outside {opened, synchronize, reopened}, then the server shall respond 422. | unit |
| AC-CI-36 | When the same agent is exported again to a repo where it is installed, the server shall regenerate the files, reuse/update the `devdigest/ci` PR and update the existing row (`agent_version`, `pr_url`, `updated_at`; status per §6.4: `active` stays `active`, `pending`/`error` become `pending`) without inserting a new one. | integration (approval) |
| AC-CI-37 | If another agent has a `pending`, `active` or `error` installation for the repo, then the server shall respond 409 `ci_repo_has_agent` with a message naming that agent, and write nothing to GitHub or the DB. | integration (approval) |
| AC-CI-38 | If the runner bundle (`ciRunnerBundlePath`, default `agent-runner/dist/index.js`, TA1) does not exist at preview/export time, then the server shall fail with `ci_runner_bundle_missing` and a message naming `cd agent-runner && pnpm build`. | unit |
| AC-CI-39 | When the zip export succeeds, the server shall upsert the installation with `status='pending'` and `pr_url` null. | integration (approval) |
| AC-CI-40 | When `POST /ci/runs/sync` runs for an installation, the server shall (automatic mode: after claiming it, TA4) list up to 20 newest completed `devdigest-review.yml` runs and ingest those not yet stored; `last_synced_at` is set by the automatic claim or by a successful manual sync. | integration (approval) |
| AC-CI-41 | If an artifact fails `CiResultArtifact` validation, then the server shall skip it with a reason and write no row. | integration (approval) |
| AC-CI-42 | The server shall take commit SHA, `github_repo_id`, PR number and run URL from the GitHub workflow-run object, and skip runs whose artifact `pr_number` differs. | integration (approval) |
| AC-CI-43 | If a workflow run's repository or workflow path does not match the installation, then the server shall skip it. | integration (approval) |
| AC-CI-44 | When the same `github_run_id` is synced again for an installation, the server shall not create a second `agent_runs` or `ci_runs` row. | integration (approval) |
| AC-CI-45 | When a valid run is ingested, the server shall write, in one transaction, `agent_runs` (`source='ci'`, installation's `agent_id`, model, status, findings_count, blockers, duration) + `run_traces` holding a valid `RunTrace` with the §6.5 fields (TA2) + `ci_runs` linked by `agent_run_id`. | integration (approval) |
| AC-CI-46 | If a completed run has no `devdigest-result` artifact, then the server shall store it with status `failed` and null findings when its conclusion is `failure` or `timed_out`, and otherwise (`skipped`, `cancelled`, `success`, `neutral`, `stale`, `action_required`) skip it with a reason and write no row (G1). | integration (approval) + unit |
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
| AC-CI-58 | When a run is ingested, the server shall set the installation `status='active'`; if sync fails with GitHub auth or 404, then it shall set `status='error'`; any other sync failure leaves the status unchanged. | integration (approval) |
| AC-CI-60 | The agent editor shall show a "CI" tab selectable via `?tab=ci`. | unit |
| AC-CI-61 | The CI tab shall show "CI deployment" and, while N ≥ 1 installations are `active`, the badge "Active in N repos". | unit |
| AC-CI-62 | The CI tab shall list each installation with repo, "GitHub Actions", installation status, last run status and relative time, or "No runs yet". | unit |
| AC-CI-63 | When the user clicks "+ Add repository", the client shall open the wizard with the repo picker defaulting to the active repo. | unit |
| AC-CI-64 | When the user clicks "Update CI config", the client shall open the wizard prefilled with the installation's repo and target and default Configure options. | unit |
| AC-CI-65 | When the user changes "Fail CI on", the client shall save `ci_fail_on` via the existing `PUT /agents/:id` (`useUpdateAgent`) and state that CI picks it up after "Update CI config". | unit |
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
| AC-CI-81 | When the runner writes `devdigest-result.json`, it shall include `model`, `manifest_version`, `gate_triggered`, `blockers` and `skills` (the manifest's skill slugs, G3), and the artifact shall still validate against `CiResultArtifact`; an artifact without these fields shall also validate. | unit (agent-runner) + unit (contracts) |
| AC-CI-82 | The CI Runs page shall show at most the 50 newest runs, accept optional `agent_id` and `repo` URL query filters (also applied by `GET /ci/runs`), and show no header statistics or pagination. | unit + integration (approval) |
| AC-CI-83 | If the edited workflow exceeds 64 KB (65 536 bytes UTF-8), then the server shall respond 422 and the Preview step shall show the limit and keep Continue disabled. | unit |
| AC-CI-84 | The Install step shall show "Need help?" linking to https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions, opened in a new tab with `rel="noopener noreferrer"`. | unit |
| AC-CI-85 | When the feature is verified, the implementer shall record the observed preview latency, export latency and `agent-runner/dist/index.js` size in the verification notes; no threshold is enforced. | manual |
| AC-CI-86 | When `GET /ci/installations?repo=owner/name` is called, the server shall return the workspace's installations on that repo as `CiInstallationView` (with `agent_name`, `status`, `last_run_status`, `last_run_at`), and none from other workspaces. | integration (approval) |
| AC-CI-87 | If an automatic sync of a claimed installation fails with a transient GitHub error (network, timeout, 429, 5xx), then the server shall restore its previous `last_synced_at` (compare-and-set) and leave its status unchanged, so the next automatic sync retries it; on an auth/404 failure it shall keep the claim and set `status='error'`. | unit + integration (approval) |
| AC-CI-88 | A manual sync shall not be blocked by `last_synced_at`, only by the 60 s per-installation manual throttle; a successful manual sync shall set `last_synced_at = now()` and a failed one shall leave it unchanged. | unit |
| AC-CI-89 | When preview, zip or open-PR export inspects the repo (§8 steps 2–4, at the base branch and `devdigest/ci` head SHAs), the server shall use `.devdigest/agents/<current-slug>.yaml` when no manifest exists, keep the path of the single manifest owned by this agent (`agent_id` match) even after a rename, and otherwise (a manifest not owned by this agent, or more than one) respond 409 `ci_manifest_conflict` naming the files and write nothing. | unit + integration (approval) |
| AC-CI-90 | If a file the export would write already exists at either inspected SHA and is not in the agent's owned set `K` (§8), then the server shall respond 409 `ci_file_conflict` naming the paths and write nothing; an export shall never delete or rename a file in the target repo. | unit + integration (approval) |
| AC-CI-91 | When an open-PR export commits, the server shall serialise exports per repo with an in-process lock and commit only if `devdigest/ci` is still at the inspected head SHA (or still absent); if the ref moved or now exists, it shall respond 409 `ci_concurrent_change` and write no PR and no installation row. | unit + integration (approval) |

## 13. Test scenarios
- T1 Wizard happy path with mocked hooks: Target → Preview (edit workflow) → Configure → Install (PR) → toast → AC-CI-01..07, 09, 11..15, 19, 79.
- T2 Wizard edge cases: preview 422, install 502, 409 other agent, regenerate prompt, close before install → AC-CI-05, 08, 10, 16, 18.
- T3 Generator unit tests: manifest round-trip (`JSON.parse` + `AgentManifest`), model mapping, slug rules, workflow string assertions (no `pull_request_target`, permissions, SHA regex, env names, fork guard, base-SHA checkout, upload step, no untrusted `${{ }}` in `run:`), bundle missing → AC-CI-20..29, 35, 38, 78.
- T4 `ci-export.it.test.ts` with mock GitHub: new install, re-export same agent (status per G5), 409 other agent incl. an `error` installation, reuse PR, default branch, zip install row, scoping, GitHub failure, `GET /ci/installations?repo=`, manifest-path rule (rename → same owned path; foreign / unparsable / multiple manifests → 409 `ci_manifest_conflict`), unknown existing files → 409 `ci_file_conflict` with zero commits, mock ref moved between inspection and commit → 409 `ci_concurrent_change` with no PR and no row, two concurrent exports serialised → AC-CI-30..34, 36, 37, 39, 80, 86, 89..91.
- T5 `ci-ingest.it.test.ts` with mock runs/artifacts (fflate fixtures) and a fake clock: valid, invalid, PR mismatch, foreign workflow, duplicate, missing artifact by conclusion (failure/timed_out stored; skipped/cancelled/success skipped), partial failure, auto throttle (assert zero mock calls), claim rollback on a transient error and kept claim on 401/404, manual throttle and manual sync ignoring `last_synced_at`, status transitions, stored trace passes `RunTrace.safeParse` → AC-CI-40..49, 55, 56, 58, 87, 88.
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

Decisions (user, 2026-10-23, P0 after the development plan):
- **G1** artifact-less runs: store `failed` only for conclusion `failure`/`timed_out`; skip the rest with a reason (§7, AC-CI-46).
- **G2** safe MVP: never leave a second manifest in a repo; `pending`, `active` and `error` installations occupy the repo; a re-export of the same agent keeps its existing manifest path even after a rename (§6.4, §8, AC-CI-37, 89). Mechanism: Q29 = A.
- **G3** the artifact carries `skills` (manifest slugs) for the trace's `dependencies.skills` (§6.2, AC-CI-81).
- **G4** `GET /ci/installations?repo=` + contracts `CiInstallationView`, `CiPreview`, `CiSyncInput`, `CiSyncResult`, `CiErrorCode` (§6.1, §6.2, AC-CI-05, 86).
- **G5** re-export keeps `active`; `pending`/`error` → `pending` (§6.4, AC-CI-36).
- **TA1** runner bundle path in `AppConfig` (`DEVDIGEST_RUNNER_BUNDLE`), default resolved from the repo root (§8, AC-CI-38).
- **TA2** the CI trace is a valid `RunTrace` + a `ci` object (§6.5, AC-CI-45).
- **TA3** manual 60 s throttle in an in-process map (§7).
- **TA4** atomic claim of `last_synced_at` before GitHub I/O, with the recovery rules of §7 (AC-CI-87, 88).

- **Q29 = A** (G2 mechanism): the target repo is the source of truth for the manifest path — inspect `.devdigest/agents/` (and the other generated paths) on the base branch and on `devdigest/ci` at fixed head SHAs; keep the path of the single manifest owned by this agent (`agent_id` in the manifest); 409 `ci_manifest_conflict` for a foreign or more than one manifest and `ci_file_conflict` for unknown existing files, without writing; never delete or overwrite unknown files; per-repo in-process lock + compare-and-swap commit on `devdigest/ci` (409 `ci_concurrent_change`) against concurrent exports and concurrent GitHub changes (§8, AC-CI-89..91). Rejected: B fixed path `.devdigest/agents/agent.yaml` and C id-based path (both cannot detect foreign or leftover manifests; B drops per-slug paths).
- **Runner package.json** (user, 2026-10-23, during B4): the ncc build emits an ESM `dist/index.js` (plus `dist/package.json` `{"type":"module"}` and a lazily loaded chunk used only by the OpenAI SDK's deprecated `fileFromPath`, which the runner never calls — not exported). Verified locally: with a root `package.json` `"type": "commonjs"` the runner fails to load unless `.devdigest/runner/package.json` `{"type":"module"}` is present. It is therefore part of the FR-4 file set and of the owned set `K` (§8); `.devdigest/runner/index.js` stays byte-equal to `agent-runner/dist/index.js` (AC-CI-26). Node 22 compatibility is verified in integration testing.
- **Pinned actions** (user, 2026-10-23, during B4; AC-CI-25): `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1`, `actions/upload-artifact` v7.0.2 `cf430e030ddbb5b0abf93d22962f4752f3646cd9` — release-tag commits resolved via the public GitHub API, recorded in `server/src/modules/ci/constants.ts`.
- **Installation removal:** no DB-only removal; `pending`, `active` and `error` installations keep occupying the repo; a safe removal together with the GitHub files is outside the MVP (§2). Deleting an agent does not clean the target repo (§6.4).

Open questions: none (§19.2).

## 16. Approvals required
- Migration 0016 (S.2): already created in the prep commit 5eee208 (S.1) and applied to B's isolated database `devdigest_export_ci`; no further migration approval is needed for B (B never runs `db:generate`).
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

### S.2 Migration 0016 — exact schema delta (created as `0016_l07_multi_agent_ci.sql` in prep commit 5eee208)
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
| `.devdigest/runner/package.json` (absent in mockup) | 3 | AC-CI-20 | Covered | Added element: `{"type":"module"}` for the ESM runner |
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
None. Q20, Q24, Q26, Q28 and A8 were decided by the user on 2026-10-23 (see §15; AC-CI-82…85, AC-CI-58); G1–G5, TA1–TA4, Q29 (= A) and installation removal likewise (§15; AC-CI-86…91).
