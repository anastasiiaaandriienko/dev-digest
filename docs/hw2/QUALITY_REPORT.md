# HW2 quality report — Skills Lab, Agents, Conventions Extractor

Branch `feature/hw-02` → `main`. Everything below was checked on this branch;
what was **not** done or **not** demonstrated is listed explicitly at the end.

## 1. Implemented features

### Skills Lab
- Workspace-scoped **Skills CRUD** API (`server/src/modules/skills`) with an
  immutable **version history**: a changed body creates a new version, metadata
  edits keep the version, **Restore** copies an old body into a NEW version
  (history is never rewritten), **Diff** compares any version with the current one.
- **Import** from `.md` / `.zip` with preview and vetting: bounded ZIP parser
  (entry / size / ratio limits, zip-slip and symlink rejection, CRC check),
  executable-content and bidi checks, imported skills saved **disabled** until vetted.
- Skills Lab UI (design: three columns): searchable list with enable toggles,
  type / source badges and agent counts; editor with **Config** (Markdown code
  editor: line numbers, highlighting, token count, unsaved marker),
  **Preview**, **Versions** (Diff / Restore), plus honest "not available yet"
  **Evals** / **Stats** tabs (no backend for them in HW2 — no fake data).
- **Unsaved-changes protection**: switching skills asks *Save and continue /
  Discard / Cancel*; a failed save keeps every edit; edits survive tab switches;
  Restore is blocked while Config is dirty; the browser asks before reload/close.

### Agents
- Agents list and editor (three columns, design N1/N2): empty state, searchable
  cards (model chip, skill count, enable toggle, delete with confirmation),
  **Config** (provider + live model list incl. **OpenRouter** with prices,
  system prompt with token count, strategy / CI gate / repo-intel, Save / Cancel)
  and **Skills** tab (attach via checkbox, per-agent enable, **drag & drop and
  ↑/↓ ordering**, detach, "off for this agent" vs "disabled globally").
- Same unsaved-changes protection as Skills (shared `UnsavedChangesModal` +
  `useUnsavedGuard`).

### Skill injection and Trace
- A run reads the agent's skills **once**: linked + enabled for the agent +
  enabled globally, in `agent_skills` order, and appends them to the **system
  prompt** (`server/src/modules/reviews/run-executor.ts`,
  `reviewer-core/src/prompt.ts`), wrapped as untrusted data.
- The run trace records `prompt_assembly.skill_blocks` (name, version, order,
  tokens per skill) and `skills_tokens`; the Trace drawer shows them
  (`RunTraceDrawer/_components/SkillsAssembly`).

### Conventions Extractor
- Pipeline (`server/src/modules/conventions`): code-only sampling of the clone
  (config files at the root **and in first-level packages**, ranked source files
  **spread across packages**), secret redaction, one structured LLM call through
  the model chosen in *Settings → Models → Conventions*, grounding of every
  candidate against the sampled lines, persisted scans and candidates.
- UI (design N7): scan summary, **Run Scan / ReScan**, candidate cards with
  category, rule, **clickable GitHub evidence** (`blob/<clone HEAD>/path#L<n>`),
  snippet and confidence; **Accept / Reject / inline Edit**; **Deselect all**
  (accepted → pending, never rejects or deletes); **Create skill** modal (draft
  merged from ACCEPTED rules only, code editor + Preview, optional agent).

### API Contract Reviewer and test-quality skills
- Four API-contract skills (`docs/skills/api-contract-reviewer/`: breaking
  change, response schema, semver discipline, deprecation policy) and a
  test-quality rubric (`docs/skills/test-quality-reviewer/`), each with a test
  that they import cleanly through the real importer.

## 2. Real-data verification (development database)

| What | Result |
|---|---|
| Conventions scan on `anastasiiaaandriienko/dev-digest` | 1 real scan, `openrouter/deepseek/deepseek-v4-flash`, 48,707 tokens in / 5,818 out, **$0.0023**; 24 candidates, 23 grounded; 16 sample files from all 4 packages |
| Evidence | every candidate's `file:line` exists in the clone; links open GitHub at commit `c3c8042` on that line |
| Reject / Edit / Accept | camelCase rule rejected; path-alias rule edited; 5 rules accepted → **7 accepted / 15 pending / 1 rejected** |
| Create skill | `repo-conventions` (convention, extracted, v1, enabled) from the 7 accepted rules, attached to **General Reviewer** |
| API Contract Reviewer | 4 imported skills attached in order, all enabled |

Skills CRUD, versioning (v1→v5, Restore → v6), import, agent creation with
OpenRouter, skill attachment / ordering and both unsaved-changes flows were
exercised end to end in the browser on an **isolated test database**.

## 3. Tests and builds (final run on this branch)

| Package | Typecheck | Tests | Build |
|---|---|---|---|
| client | ✅ | **486 / 486** | ✅ `next build` |
| server — unit | ✅ | **238 passed, 6 failed** (see below) | ✅ `tsc` |
| server — integration (Testcontainers) | — | **125 / 125** | — |
| reviewer-core | ✅ | **33 / 33** | — |

`git diff --check origin/main...HEAD` is clean.

**The 6 server unit failures are pre-existing and Windows-only**:
`test/indexer-pipeline.test.ts` (repo-intel indexer). Its helper creates
folders with `full.lastIndexOf('/')` after `path.join`, which yields `\` on
Windows, so the folder is never created (`ENOENT`). The file is unchanged
since the original snapshot (`587c46a`) and HW2 does not touch repo-intel.

## 4. Pre-PR self-review fixes (included in this PR)
- **Security:** `POST /skills` now creates only `manual` skills (a client can no
  longer label its own text as `imported`/`extracted`), and manual create/update
  run the same executable-content and bidi checks as imports.
- **Security (DoS):** the `<meta http-equiv>` and inline-event-handler patterns
  are bounded, so a long run of `<a` without `>` no longer backtracks
  quadratically; over-length input is not scanned.
- Regression tests: `server/test/skill-contracts.test.ts`, one new case in
  `server/test/skills.it.test.ts`. Both `vendor/shared` copies changed identically.

## 5. Known limitations
- Approved during HW2 (flagged by the self-review as hard-rule items):
  dependency `fflate` (ZIP import) and migrations `0010` / `0011`.
- No token budget for the Skills section of a prompt (many large skills could
  overflow the context; map-reduce repeats the section per file).
- Changing an agent's skill links does not snapshot a new agent version, so
  `config.version` in a trace may not match the skills used — `skill_blocks` in
  the trace is the source of truth.
- Some caches are not refreshed after deletes (agent `skill_count` after a skill
  delete; skill `agent_count` after an agent delete) until the next refetch.
- The unsaved-changes guard covers list cards, in-editor links and browser
  reload/close, not the breadcrumb, app navigation or keyboard shortcuts.
- Evidence is a single line (`file:23`), not a range; a skill created from
  conventions defaults to the name `repo-conventions` (editable).
- Evals, Stats metrics, Community search and Import from URL are later homework
  and are shown as unavailable, without sample data.

## 6. Not yet done / not demonstrated
- **API Contract Reviewer A/B experiment (skills off vs on) — NOT run.** No
  sandbox repository or PR was created; no comparison results exist.
- **No real review has been executed with skills attached.** Prompt injection
  and the Trace fields are implemented and unit-tested, but none of the real
  traces in the development database contains `skill_blocks` yet. (The API
  Contract Reviewer is configured as `openai/gpt-4.1` while no OpenAI key is
  set; it must be switched to OpenRouter before such a run.)
- **Demo video — does not exist yet.**

## 7. Evidence
Screenshots in [`screenshots/`](screenshots/): 01–06 from the isolated test
database (Skills versions / diff / unsaved changes, Agent config / skills /
empty state), 07–12 from the real development database (Conventions scan,
GitHub evidence, edited rule, create-skill modal, `repo-conventions` skill,
General Reviewer skills).
