import { strToU8, zipSync } from 'fflate';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallationView,
  CiPreview,
  GitHubClient,
  RepoRef,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentsRepository } from '../agents/repository.js';
import { RepoRepository } from '../repos/repository.js';
import { readRunnerBundle } from './bundle.js';
import {
  CI_BRANCH,
  INSPECTED_DIRS,
  MANIFEST_DIR,
  MAX_MANIFEST_BYTES,
  PR_TITLE,
  RUNNER_PACKAGE_JSON_PATH,
  RUNNER_PATH,
  SKILLS_DIR,
  WORKFLOW_PATH,
} from './constants.js';
import { buildCiFiles, prBody, RepoLocks, toInstallation, toInstallationView, workflowOverride } from './helpers.js';
import { CiRepository } from './repository.js';
import type { ManifestAgent, ManifestSkill } from './manifest.js';

/**
 * Export to CI (L07, specs/export-to-ci.md §6.1, §8 "Manifest path and file
 * safety", Q29, G2, G4, G5): preview, open-PR export and zip export.
 *
 * Every GitHub read happens at fixed commit SHAs; the only GitHub writes are
 * one compare-and-swap commit on `devdigest/ci` and opening the PR. A partial
 * success (commit landed, PR or DB failed) is never undone: the commit only
 * sits on `devdigest/ci`, and a retry finds this agent's own manifest there
 * and continues (new commit, existing or new PR, upsert).
 */

export interface CiServiceDeps {
  installations: Pick<
    CiRepository,
    'findBlockingInstallation' | 'upsertInstallationExclusive' | 'listForAgent' | 'listForRepo'
  >;
  agents: Pick<AgentsRepository, 'getById' | 'effectiveSkills'>;
  repos: Pick<RepoRepository, 'findByFullName'>;
  github: () => Promise<GitHubClient>;
  readBundle: () => Promise<string>;
  locks: RepoLocks;
}

/** One lock table per process: exports to the same repo never interleave (§8 step 1). */
const PROCESS_REPO_LOCKS = new RepoLocks();

interface ExportContext {
  workspaceId: string;
  agent: ManifestAgent;
  skills: ManifestSkill[];
  /** Canonical `owner/name` from the workspace's repos table. */
  repo: string;
  ref: RepoRef;
  input: CiExportInput;
  runnerBundle: string;
}

interface Inspection {
  base: string;
  baseSha: string;
  headSha: string | null;
  files: CiFile[];
}

export interface CiZip {
  filename: string;
  bytes: Uint8Array;
}

export class CiService {
  private readonly deps: CiServiceDeps;

  constructor(container: Container, deps: Partial<CiServiceDeps> = {}) {
    this.deps = {
      installations: deps.installations ?? new CiRepository(container.db),
      agents: deps.agents ?? container.agentsRepo,
      repos: deps.repos ?? new RepoRepository(container.db),
      github: deps.github ?? (() => container.github()),
      readBundle: deps.readBundle ?? (() => readRunnerBundle(container.config.ciRunnerBundlePath)),
      locks: deps.locks ?? PROCESS_REPO_LOCKS,
    };
  }

  /** The files an export would write — no GitHub write, no DB write (AC-CI-06, 20). */
  async preview(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiPreview> {
    const ctx = await this.load(workspaceId, agentId, input);
    await this.assertRepoFree(ctx);
    const gh = await this.github();
    const inspection = await this.inspect(gh, ctx);
    return { files: inspection.files };
  }

  /** Open or update the `devdigest/ci` PR (AC-CI-30..37, 80, 89..91). */
  async exportPr(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    if (input.action !== 'open_pr') {
      throw new ValidationError('Use action "open_pr", or the zip export to download the files');
    }
    const ctx = await this.load(workspaceId, agentId, input);
    return this.deps.locks.run(ctx.repo, async () => {
      await this.assertRepoFree(ctx);
      const gh = await this.github();
      const inspection = await this.inspect(gh, ctx);

      // An open PR from devdigest/ci into another base is never silently reused:
      // refuse before any commit or DB write; the PR is left as it is.
      const open = await viaGitHub(() => gh.findOpenPr(ctx.ref, CI_BRANCH));
      if (open && open.base !== inspection.base) {
        throw new AppError(
          'ci_pr_base_mismatch',
          `An open DevDigest PR (${open.url}) targets "${open.base}", not "${inspection.base}". Close it or export to "${open.base}". Nothing was written.`,
          409,
          { pr_url: open.url, pr_base: open.base, requested_base: inspection.base },
        );
      }

      const commit = await viaGitHub(() =>
        gh.commitFilesIfUnchanged(ctx.ref, {
          branch: CI_BRANCH,
          expectedHeadSha: inspection.headSha,
          baseSha: inspection.baseSha,
          message: `chore(devdigest): add DevDigest CI review (${slugOf(inspection)} v${ctx.agent.version})`,
          files: inspection.files.map((f) => ({ path: f.path, contents: f.contents })),
        }),
      );
      if (!commit.ok) {
        throw new AppError(
          'ci_concurrent_change',
          `${CI_BRANCH} changed on GitHub while the export ran; nothing was written. Try again.`,
          409,
          { branch: CI_BRANCH },
        );
      }

      const pr =
        open ??
        (await viaGitHub(() =>
          gh.openPullRequest(ctx.ref, {
            title: PR_TITLE,
            head: CI_BRANCH,
            base: inspection.base,
            body: prBody(ctx.repo, inspection.files),
          }),
        ));

      const installation = await this.saveInstallation(ctx, pr.url);
      return { installation: toInstallation(installation), files: inspection.files, pr_url: pr.url };
    });
  }

  /** The same file set as a zip; GitHub is only read (AC-CI-17, 39). */
  async exportZip(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiZip> {
    const ctx = await this.load(workspaceId, agentId, input);
    return this.deps.locks.run(ctx.repo, async () => {
      await this.assertRepoFree(ctx);
      const gh = await this.github();
      const inspection = await this.inspect(gh, ctx);
      const bytes = zipSync(Object.fromEntries(inspection.files.map((f) => [f.path, strToU8(f.contents)])));
      await this.saveInstallation(ctx, null);
      return { filename: `devdigest-ci-${slugOf(inspection)}.zip`, bytes };
    });
  }

  async listForAgent(workspaceId: string, agentId: string): Promise<CiInstallationView[]> {
    if (!(await this.deps.agents.getById(workspaceId, agentId))) throw new NotFoundError('Agent not found');
    return (await this.deps.installations.listForAgent(workspaceId, agentId)).map(toInstallationView);
  }

  async listForRepo(workspaceId: string, repo: string): Promise<CiInstallationView[]> {
    return (await this.deps.installations.listForRepo(workspaceId, repo)).map(toInstallationView);
  }

  // ---- steps -----------------------------------------------------------------

  /** Agent, skills, workspace repo, edited workflow and bundle — all before any GitHub call. */
  private async load(workspaceId: string, agentId: string, input: CiExportInput): Promise<ExportContext> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (input.target !== 'gha') throw new ValidationError(`CI target "${input.target}" is not available yet`);
    const repoRow = await this.deps.repos.findByFullName(workspaceId, input.repo);
    if (!repoRow) throw new ValidationError(`${input.repo} is not a repository of this workspace`);
    workflowOverride(input.files); // 422 early: other paths, > 64 KB, pull_request_target
    const skills = await this.deps.agents.effectiveSkills(workspaceId, agentId);
    const runnerBundle = await this.deps.readBundle();
    return {
      workspaceId,
      agent: {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        provider: agent.provider,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        strategy: agent.strategy,
        ciFailOn: agent.ciFailOn,
      },
      skills: skills.map((s) => ({ name: s.name, body: s.body })),
      repo: repoRow.fullName,
      ref: { owner: repoRow.owner, name: repoRow.name },
      input,
      runnerBundle,
    };
  }

  /** G2: another agent's pending/active/error installation → 409 before any GitHub call. */
  private async assertRepoFree(ctx: ExportContext): Promise<void> {
    const blocking = await this.deps.installations.findBlockingInstallation(
      ctx.workspaceId,
      ctx.repo,
      ctx.input.target,
      ctx.agent.id,
    );
    if (blocking) throw repoHasAgent(ctx.repo, blocking);
  }

  /** §8 steps 2–4: snapshot SHAs, list the generated paths, decide manifest path and owned set. */
  private async inspect(gh: GitHubClient, ctx: ExportContext): Promise<Inspection> {
    const snapshot = await viaGitHub(async () => {
      const base = ctx.input.base ?? (await gh.getDefaultBranch(ctx.ref));
      const baseSha = await gh.getBranchHeadSha(ctx.ref, base);
      const headSha = await gh.getBranchHeadSha(ctx.ref, CI_BRANCH);
      const shas = headSha ? [baseSha, headSha] : [baseSha];
      // path → the inspected SHAs it exists at
      const existing = new Map<string, string[]>();
      if (baseSha) {
        for (const sha of shas as string[]) {
          for (const dir of INSPECTED_DIRS) {
            for (const entry of await gh.listDirectory(ctx.ref, dir, sha)) {
              existing.set(entry.path, [...(existing.get(entry.path) ?? []), sha]);
            }
          }
        }
      }
      return { base, baseSha, headSha, existing };
    });
    if (!snapshot.baseSha) throw new ValidationError(`Base branch "${snapshot.base}" does not exist in ${ctx.repo}`);
    const { existing } = snapshot;

    const manifests = [...existing.keys()].filter((p) => isManifestPath(p)).sort();
    let manifestPath: string | undefined;
    const owned = new Set<string>();
    if (manifests.length > 1) throw manifestConflict(manifests, 'more than one agent manifest');
    if (manifests.length === 1) {
      const path = manifests[0]!;
      const ownedSkills = new Set<string>();
      for (const sha of existing.get(path)!) {
        const manifest = await this.readOwnedManifest(gh, ctx, path, sha);
        if (!manifest) throw manifestConflict([path], 'a manifest of another agent or one DevDigest cannot read');
        manifest.skills.forEach((s) => ownedSkills.add(s));
      }
      manifestPath = path;
      for (const p of [path, RUNNER_PATH, RUNNER_PACKAGE_JSON_PATH, WORKFLOW_PATH]) owned.add(p);
      for (const s of ownedSkills) owned.add(`${SKILLS_DIR}/${s}.md`);
    }

    const files = buildCiFiles({
      agent: ctx.agent,
      skills: ctx.skills,
      input: ctx.input,
      runnerBundle: ctx.runnerBundle,
      manifestPath,
    });
    const unowned = files.map((f) => f.path).filter((p) => existing.has(p) && !owned.has(p));
    if (unowned.length > 0) {
      throw new AppError(
        'ci_file_conflict',
        `${ctx.repo} already has files DevDigest did not write for this agent: ${unowned.join(', ')}. Nothing was written.`,
        409,
        { paths: unowned },
      );
    }
    return { base: snapshot.base, baseSha: snapshot.baseSha, headSha: snapshot.headSha, files };
  }

  /**
   * A manifest is this agent's when it parses as YAML (the runner's parser; JSON
   * is YAML too) into a valid AgentManifest carrying our agent_id. Anything
   * else — oversized, several documents, aliases, invalid, another agent — is
   * not owned, so it is never overwritten.
   */
  private async readOwnedManifest(
    gh: GitHubClient,
    ctx: ExportContext,
    path: string,
    sha: string,
  ): Promise<AgentManifest | null> {
    let text: string | null;
    try {
      text = await gh.readFile(ctx.ref, path, sha);
    } catch (err) {
      if ((err as { status?: number }).status === 422) return null; // not a file
      throw toGitHubError(err);
    }
    if (text === null || Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) return null;
    try {
      // Aliases are refused outright (no expansion bombs); a manifest needs none.
      const parsed = AgentManifest.safeParse(parseYaml(text, { maxAliasCount: 0, uniqueKeys: true }));
      return parsed.success && parsed.data.agent_id === ctx.agent.id ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async saveInstallation(ctx: ExportContext, prUrl: string | null) {
    const res = await this.deps.installations.upsertInstallationExclusive({
      workspaceId: ctx.workspaceId,
      agentId: ctx.agent.id,
      repo: ctx.repo,
      targetType: ctx.input.target,
      agentVersion: ctx.agent.version,
      prUrl,
    });
    if (res.ok) return res.installation;
    if (res.reason === 'agent_not_found') throw new NotFoundError('Agent not found');
    throw repoHasAgent(ctx.repo, res.occupiedBy);
  }

  private async github(): Promise<GitHubClient> {
    return this.deps.github();
  }
}

// ---- helpers local to the service -------------------------------------------

function isManifestPath(path: string): boolean {
  if (!path.startsWith(`${MANIFEST_DIR}/`)) return false;
  const name = path.slice(MANIFEST_DIR.length + 1);
  // The runner treats every *.yaml|*.yml entry of the directory as a manifest.
  return !name.includes('/') && /\.ya?ml$/.test(name);
}

function slugOf(inspection: Inspection): string {
  const manifest = inspection.files.find((f) => f.path.startsWith(`${MANIFEST_DIR}/`))!;
  return manifest.path.slice(MANIFEST_DIR.length + 1).replace(/\.ya?ml$/, '');
}

function repoHasAgent(repo: string, agent: { agentId: string; agentName: string }): AppError {
  return new AppError(
    'ci_repo_has_agent',
    `${repo} already runs the agent "${agent.agentName}" in CI. One agent per repository for now.`,
    409,
    { agent_id: agent.agentId, agent_name: agent.agentName },
  );
}

function manifestConflict(paths: string[], what: string): AppError {
  return new AppError(
    'ci_manifest_conflict',
    `The repository already has ${what}: ${paths.join(', ')}. Nothing was written.`,
    409,
    { paths },
  );
}

/** A GitHub failure → 502 with GitHub's reason (AC-CI-34). App errors pass through. */
function toGitHubError(err: unknown): Error {
  if (err instanceof AppError) return err;
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  return new ExternalServiceError(`GitHub request failed${status ? ` (HTTP ${status})` : ''}: ${message}`, {
    status: status ?? null,
  });
}

async function viaGitHub<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toGitHubError(err);
  }
}
