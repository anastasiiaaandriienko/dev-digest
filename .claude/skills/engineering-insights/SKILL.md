---
name: engineering-insights
description: Reads and records verified, non-obvious engineering insights in per-package INSIGHTS.md files (server/, client/, reviewer-core/, e2e/) of the DevDigest repo. Use before starting meaningful coding, debugging, refactoring, or implementation work in a package (to load prior insights), when a non-obvious technical fact, root cause, pitfall, or library quirk has just been verified, and at the wrap-up of a substantial session. Also invoked manually as /engineering-insights.
argument-hint: "[read <package> | record | wrap-up]"
---

# Engineering Insights

Keeps a small, verified knowledge base per package so later tasks start from what earlier tasks learned.
Files: `server/INSIGHTS.md`, `client/INSIGHTS.md`, `reviewer-core/INSIGHTS.md`, `e2e/INSIGHTS.md`. Never `LEARNINGS.md`, never a root-level insights file.

Automatic loading of this skill is decided by the model from the description above and is **not guaranteed**. When in doubt, the user can invoke `/engineering-insights` explicitly.

## Modes

Arguments: `$ARGUMENTS`

- `read <package>` → run **Reading** for that package only.
- `record` → run **Recording** for the finding just verified in this conversation.
- `wrap-up` → run **Wrap-up** for the current session.
- No argument → infer the mode: before work → Reading; after a verified discovery → Recording; at the end of a session → Wrap-up.

## Package ownership

| Paths touched | Owning file |
|---|---|
| `server/**` (incl. `server/src/vendor/shared`, migrations, repo-intel) | `server/INSIGHTS.md` |
| `client/**` (incl. `client/src/vendor/shared`, `client/messages`) | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**`, `scripts/e2e.sh` | `e2e/INSIGHTS.md` |
| `scripts/dev.sh`, `.github/workflows/*`, root files | the package whose behavior is affected; if unclear, ask the user |

If several packages are involved, write ONE entry in the primary owning package and describe the others in its **Cross-package** field. Do not copy the entry into every file.

## Reading (before work)

1. Determine which packages the task touches. Read only those `INSIGHTS.md` files.
2. If a file does not exist, continue normally. Do NOT create it just to read it.
3. Use entries as context, not as truth. Before relying on an entry for a decision, re-check its **Evidence** against the current code (`Grep`/`Read`). Code may have moved on.
4. If an entry is contradicted by current code, mention it to the user and flag it during Recording (see **Outdated entries**).
5. Briefly tell the user which insights (titles) are relevant to the task, or that none exist.

## What qualifies

Record only if ALL hold: verified in this session (code read, command output, test result), non-obvious from a quick read of the code, reusable for future tasks, not already in `AGENTS.md` / `CLAUDE.md`, a README, `TESTING.md`, or an existing insight.

Record:
- architectural constraints and cross-package dependencies;
- bug root causes together with the verified fix;
- reusable codebase patterns;
- important tool / library behavior (Fastify, Drizzle, Next.js, Zod, Vitest, pnpm/npm, Windows shell);
- decisions with their technical justification;
- non-obvious pitfalls and how to avoid them.

Do NOT record: generic programming advice, unverified assumptions (unless as an Open Question), routine summaries of completed work, trivia obvious from the code, duplicates. If nothing qualifies, write nothing and say so.

Distinguish verified implementation facts from runtime behavior:
- Code inspection can verify what the implementation does structurally.
- Do not claim that a suspected runtime bug is reproduced unless a test or execution confirms it.
- If runtime behavior is uncertain, explicitly label it as a hypothesis or Open Question.

## Categories

`What Works` · `What Doesn't Work` · `Codebase Patterns` · `Tool & Library Notes` · `Recurring Errors & Fixes` · `Session Notes` · `Open Questions`

- `Open Questions` are explicitly unresolved: state what was checked and what is still unknown. Never phrase them as facts.
- `Session Notes` only for a non-obvious session-level takeaway, never a log of what was done.

## Entry format

```markdown
### YYYY-MM-DD — <short actionable title>
- **Category:** <one category from the list above>
- **Status:** verified | open
- **Discovery:** <what is true and why it matters — specific, 1–3 sentences>
- **Evidence:** `<repo-relative/path.ts>:<line>` (`<symbol>`) — <what that line shows>; <command + observed result, if any>
- **Guidance:** <what to do / avoid next time>
- **Cross-package:** <affected packages and how> (omit if none)
```

Rules for **Evidence**:
- Repo-relative paths with forward slashes, e.g. `server/src/modules/reviews/run-executor.ts:190` (`reviewPullRequest` call).
- Confirm every line number with `Grep -n` or `Read` immediately before writing. Add the symbol name so the entry survives line drift.
- Never invent paths, line numbers, commands, or results. If something could not be verified, use `Status: open` under `Open Questions`.

## Recording (safe persistence)

1. Draft the entry and check it against **What qualifies**. Drop it if it fails.
2. Pick the owning file (**Package ownership**).
3. **Read the whole target file right before writing** (it may have changed since the last read).
4. Duplicates: if an existing entry already says the same thing, do not add a new one. If yours adds verified detail, append a new entry that references the old title (`Extends: "<old title>"`).
5. Contradictions: see **Outdated entries**. Never write two conflicting "verified" entries without a flag.
6. Append the entry at the END of the file with `Edit` (or `Write` only when creating a new file). Never reorder, reformat, shorten, or delete existing content.
7. Creating a file is allowed only together with its first real entry. New-file header:
   ```markdown
   # <package> — Engineering Insights

   Verified, non-obvious knowledge for `<package>/`. Append-only; maintained via the `engineering-insights` skill.
   ```
8. Report to the user: file path, entry title(s), and anything flagged.

## Outdated entries

Never modify, insert lines into, reorder, or delete existing insight entries.

When current code contradicts an existing insight:

1. Read the existing INSIGHTS.md file and verify the contradiction against current code.
2. Append a new entry at the END of the file explaining what changed.
3. Include Supersedes (pending review): "<old title>" in the new entry.
4. Clearly explain that the previous insight is outdated and should no longer be relied upon.
5. Tell the user which previous entry needs review.
6. Never delete or consolidate previous entries without explicit user approval.

## Wrap-up (end of a substantial session)

Run only after meaningful coding/debugging, not after trivial edits or pure Q&A.

1. List candidate discoveries from this session: root causes, failed approaches and why, verified fixes, library quirks, patterns, decisions.
2. Filter each through **What qualifies**; re-verify evidence lines.
3. Record the survivors via **Recording** (one entry per insight, max ~5 per session — prefer fewer, stronger entries).
4. Report: written entries per file, skipped candidates with the reason, open questions.
5. If nothing qualifies: write nothing and say "No new insights."

## Boundaries

- This skill edits only `*/INSIGHTS.md`. It never changes application code, `AGENTS.md`, `CLAUDE.md`, migrations, or lockfiles.
- Keep entries short; an `INSIGHTS.md` is a lookup aid, not documentation. If a file grows past ~100 entries, suggest a user-approved consolidation instead of pruning on your own.
