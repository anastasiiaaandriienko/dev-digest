import type { CiExportInput, CiFile, CiInstallation, CiInstallationView } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { RUNNER_PACKAGE_JSON, RUNNER_PACKAGE_JSON_PATH, RUNNER_PATH, WORKFLOW_PATH } from './constants.js';
import { buildManifest, type ManifestAgent, type ManifestSkill } from './manifest.js';
import type { CiInstallationListRow, CiInstallationRow } from './repository.js';
import { assertEditedWorkflow, renderWorkflow, type WorkflowOptions } from './workflow.js';

/**
 * The exact Export-to-CI file set (FR-4, AC-CI-20): the manifest, one skill
 * file per enabled linked skill in link order, the runner bundle, the runner's
 * `package.json` (`{"type":"module"}`) and the workflow — nothing else (no memory.jsonl). Deterministic for the same agent
 * version and input: no timestamps, no randomness. Only the workflow is
 * editable (AC-CI-07); an edit from Preview replaces the generated text.
 */
export interface CiFileSetInput {
  agent: ManifestAgent;
  skills: readonly ManifestSkill[];
  input: Pick<CiExportInput, 'triggers' | 'post_as' | 'files'>;
  /** Contents of the built runner bundle (readRunnerBundle). */
  runnerBundle: string;
  /** Kept manifest path from the repo inspection (Q29); default `<slug>.yaml`. */
  manifestPath?: string;
  /** Test seam for the pinned actions. */
  actions?: WorkflowOptions['actions'];
}

export function buildCiFiles(args: CiFileSetInput): CiFile[] {
  const { agentSlug, files: manifestFiles } = buildManifest(args.agent, args.skills, args.manifestPath);
  const edited = workflowOverride(args.input.files);
  const workflow =
    edited ??
    renderWorkflow({
      triggers: args.input.triggers,
      postAs: args.input.post_as,
      agentSlug,
      agentVersion: args.agent.version,
      actions: args.actions,
    });
  return [
    ...manifestFiles,
    { path: RUNNER_PATH, contents: args.runnerBundle, editable: false },
    { path: RUNNER_PACKAGE_JSON_PATH, contents: RUNNER_PACKAGE_JSON, editable: false },
    { path: WORKFLOW_PATH, contents: workflow, editable: true },
  ];
}

/** The edited workflow, if Preview sent one; any other path is refused (only the workflow is editable). */
export function workflowOverride(files: readonly CiFile[] | undefined): string | null {
  if (!files || files.length === 0) return null;
  const others = files.filter((f) => f.path !== WORKFLOW_PATH);
  if (others.length > 0) {
    throw new ValidationError(`Only ${WORKFLOW_PATH} can be edited`, { paths: others.map((f) => f.path) });
  }
  if (files.length > 1) throw new ValidationError(`${WORKFLOW_PATH} was sent more than once`);
  const text = files[0]!.contents;
  assertEditedWorkflow(text);
  return text;
}

// ---- DTOs -------------------------------------------------------------------

export function toInstallation(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    status: row.status,
    agent_version: row.agentVersion,
    pr_url: row.prUrl,
    updated_at: row.updatedAt.toISOString(),
    last_synced_at: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}

export function toInstallationView(row: CiInstallationListRow): CiInstallationView {
  return {
    ...toInstallation(row.installation),
    agent_name: row.agentName,
    last_run_status: row.lastRunStatus,
    last_run_at: row.lastRunAt ? row.lastRunAt.toISOString() : null,
  };
}

// ---- export PR ----------------------------------------------------------------

/**
 * Body of the export PR: what it adds and what the maintainer has to do. Only
 * constants, the repo name and generated paths — no agent text, no secrets.
 */
export function prBody(repo: string, files: readonly CiFile[]): string {
  return [
    `DevDigest adds an automated review of pull requests in \`${repo}\`.`,
    '',
    '**Files**',
    ...files.map((f) => `- \`${f.path}\``),
    '',
    '**Before merging**',
    '- Add the `OPENROUTER_API_KEY` secret: Settings → Secrets and variables → Actions. `GITHUB_TOKEN` is provided by GitHub Actions.',
    '- To post as a GitHub review, allow GitHub Actions to create and approve pull requests (Settings → Actions → General).',
    '',
    '**After merging**',
    '- The review runs on pull requests opened after this one is merged: it uses the runner, manifest and skills of the base commit.',
    '- Pull requests from forks are skipped (they get no secrets).',
    '- To block merging, mark the `DevDigest review / review` check as required in branch protection or a ruleset.',
    '',
    'Help: https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions',
    '',
  ].join('\n');
}

// ---- per-repo in-process lock -------------------------------------------------

/**
 * Serialises async work per key (§8 step 1): the next caller for a repo starts
 * when the previous one settled. Keys are case-insensitive like GitHub names.
 */
export class RepoLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const k = key.toLowerCase();
    const previous = this.tails.get(k) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => mine);
    this.tails.set(k, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(k) === tail) this.tails.delete(k);
    }
  }

  /** Keys currently held or queued (tests). */
  get size(): number {
    return this.tails.size;
  }
}
