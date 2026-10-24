import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { CiExportInput, type CiExportInputBody, type RepoRef, type OpenPrPayload } from '@devdigest/shared';
import { MockGitHubClient, type MockGitHubOptions } from '../src/adapters/mocks.js';
import { AppError } from '../src/platform/errors.js';
import { CiService, type CiServiceDeps } from '../src/modules/ci/service.js';
import { RepoLocks } from '../src/modules/ci/helpers.js';
import {
  CI_BRANCH,
  RUNNER_PACKAGE_JSON_PATH,
  RUNNER_PATH,
  WORKFLOW_PATH,
} from '../src/modules/ci/constants.js';
import type { CiInstallationRow, UpsertInstallationInput, UpsertInstallationResult } from '../src/modules/ci/repository.js';
import ciRoutes from '../src/modules/ci/routes.js';

/**
 * L07 B6 — CiService (preview, open-PR and zip export) against MockGitHubClient
 * and in-memory stores (specs/export-to-ci.md §6.1, §8 Q29, G2, G4, G5;
 * AC-CI-17, 20, 30..39, 75, 77, 80, 89..91). No DB, no network, no LLM.
 */

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const REPO = 'acme/widgets';
const BUNDLE = '/* runner */ export {};\n';
const SECRET = 'sk-or-test-SECRET-VALUE';

// ---- in-memory stores -----------------------------------------------------------

interface FakeAgent {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
}

class FakeInstallations {
  rows: CiInstallationRow[] = [];
  failNextUpsert = false;
  constructor(private readonly agents: Map<string, FakeAgent>) {}

  async findBlockingInstallation(workspaceId: string, repo: string, targetType: string, exceptAgentId: string) {
    const row = this.rows.find(
      (r) =>
        r.repo === repo &&
        r.targetType === targetType &&
        r.agentId !== exceptAgentId &&
        this.agents.get(r.agentId)?.workspaceId === workspaceId,
    );
    return row ? { agentId: row.agentId, agentName: this.agents.get(row.agentId)!.name } : undefined;
  }

  async upsertInstallationExclusive(input: UpsertInstallationInput): Promise<UpsertInstallationResult> {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error('db down');
    }
    const blocking = await this.findBlockingInstallation(input.workspaceId, input.repo, input.targetType, input.agentId);
    if (blocking) return { ok: false, reason: 'repo_has_agent', occupiedBy: blocking };
    const now = new Date('2026-10-23T10:00:00Z');
    const existing = this.rows.find((r) => r.agentId === input.agentId && r.repo === input.repo);
    if (existing) {
      Object.assign(existing, {
        status: existing.status === 'active' ? 'active' : 'pending',
        agentVersion: input.agentVersion,
        prUrl: input.prUrl,
        updatedAt: now,
      });
      return { ok: true, created: false, installation: existing };
    }
    const row: CiInstallationRow = {
      id: `inst-${this.rows.length + 1}`,
      agentId: input.agentId,
      repo: input.repo,
      targetType: input.targetType,
      installedAt: now,
      status: 'pending',
      agentVersion: input.agentVersion,
      prUrl: input.prUrl,
      updatedAt: now,
      lastSyncedAt: null,
    };
    this.rows.push(row);
    return { ok: true, created: true, installation: row };
  }

  async listForAgent(workspaceId: string, agentId: string) {
    return this.rows
      .filter((r) => r.agentId === agentId && this.agents.get(r.agentId)?.workspaceId === workspaceId)
      .map((r) => ({ installation: r, agentName: this.agents.get(r.agentId)!.name, lastRunStatus: null, lastRunAt: null }));
  }

  async listForRepo(workspaceId: string, repo: string) {
    return this.rows
      .filter((r) => r.repo === repo && this.agents.get(r.agentId)?.workspaceId === workspaceId)
      .map((r) => ({ installation: r, agentName: this.agents.get(r.agentId)!.name, lastRunStatus: null, lastRunAt: null }));
  }
}

/** Mock GitHub whose PR creation can be made to fail once (partial success). */
class FlakyGitHub extends MockGitHubClient {
  failNextPr = false;
  override async openPullRequest(repo: RepoRef, payload: OpenPrPayload) {
    if (this.failNextPr) {
      this.failNextPr = false;
      throw Object.assign(new Error('Validation Failed'), { status: 422 });
    }
    return super.openPullRequest(repo, payload);
  }
}

const BASE_TREE = { 'README.md': '# widgets', 'package.json': '{"type":"commonjs"}' };

function setup(gh: Partial<MockGitHubOptions> = {}) {
  const agents = new Map<string, FakeAgent>([
    [AGENT_ID, { id: AGENT_ID, workspaceId: WS, name: 'Security Reviewer', version: 3, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'Review.', strategy: 'single-pass', ciFailOn: 'critical' }],
    [OTHER_AGENT_ID, { id: OTHER_AGENT_ID, workspaceId: WS, name: 'Perf Reviewer', version: 1, provider: 'openrouter', model: 'x/y', systemPrompt: 'Perf.', strategy: 'auto', ciFailOn: 'never' }],
  ]);
  const skills = new Map<string, { name: string; body: string }[]>([
    [AGENT_ID, [{ name: 'OWASP', body: 'Flag injection.' }]],
    [OTHER_AGENT_ID, []],
  ]);
  const installations = new FakeInstallations(agents);
  const github = new FlakyGitHub({ defaultBranch: 'main', branches: { main: 'b0' }, trees: { b0: { ...BASE_TREE } }, ...gh });
  let bundleReads = 0;
  const deps: CiServiceDeps = {
    installations,
    agents: {
      getById: async (ws: string, id: string) => {
        const a = agents.get(id);
        return a && a.workspaceId === ws ? (a as never) : undefined;
      },
      effectiveSkills: async (_ws: string, id: string) =>
        (skills.get(id) ?? []).map((s, i) => ({ id: `s${i}`, name: s.name, version: 1, body: s.body, order: i })),
    },
    repos: {
      findByFullName: async (ws: string, fullName: string) =>
        ws === WS && fullName === REPO ? ({ fullName: REPO, owner: 'acme', name: 'widgets' } as never) : undefined,
    },
    github: async () => github,
    readBundle: async () => {
      bundleReads++;
      return BUNDLE;
    },
    locks: new RepoLocks(),
  };
  const service = new CiService({} as never, deps);
  const writes = () => github.calls.filter((c) => ['commitFilesIfUnchanged', 'openPullRequest', 'commitFiles'].includes(c.method));
  return { service, github, installations, agents, skills, writes, bundleReads: () => bundleReads };
}

const input = (over: CiExportInputBody = { repo: REPO }) => CiExportInput.parse({ repo: REPO, triggers: ['opened', 'synchronize'], ...over });

async function caught(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
}

const ownManifest = (agentId: string, skills: string[] = []) =>
  JSON.stringify({ name: 'Old Name', agent_id: agentId, version: 1, provider: 'openrouter', model: 'm', system_prompt: 'p', skills, strategy: 'auto', ci_fail_on: 'critical' });

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = SECRET;
});
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe('preview (AC-CI-06, 20)', () => {
  it('returns the FR-4 file set incl. runner package.json, reading GitHub only and writing nothing', async () => {
    const { service, github, installations, writes } = setup();
    const res = await service.preview(WS, AGENT_ID, input());
    expect(res.files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/owasp.md',
      RUNNER_PATH,
      RUNNER_PACKAGE_JSON_PATH,
      WORKFLOW_PATH,
    ]);
    expect(writes()).toEqual([]);
    expect(installations.rows).toEqual([]);
    expect(github.calls.map((c) => c.method)).toEqual([
      'getDefaultBranch',
      'getBranchHeadSha',
      'getBranchHeadSha',
      'listDirectory',
      'listDirectory',
      'listDirectory',
      'listDirectory',
    ]);
    // every listing is at the base SHA, never at a branch name
    expect(github.calls.filter((c) => c.method === 'listDirectory').map((c) => c.args[2])).toEqual(['b0', 'b0', 'b0', 'b0']);
  });

  it('uses the given base branch, and 422 when it does not exist (AC-CI-80)', async () => {
    const { service, github } = setup({ branches: { main: 'b0', develop: 'd0' }, trees: { d0: {} } });
    await service.preview(WS, AGENT_ID, input({ repo: REPO, base: 'develop' }));
    expect(github.calls.some((c) => c.method === 'getDefaultBranch')).toBe(false);
    const err = await caught(service.preview(WS, AGENT_ID, input({ repo: REPO, base: 'nope' })));
    expect(err.statusCode).toBe(422);
    expect(err.message).toContain('Base branch "nope"');
  });
});

describe('open-PR export (AC-CI-30..32, 36)', () => {
  it('a first export: one CAS commit on devdigest/ci from the base SHA, a PR, a pending installation', async () => {
    const { service, github, installations } = setup();
    const res = await service.exportPr(WS, AGENT_ID, input());
    expect(github.casCommits).toHaveLength(1);
    expect(github.casCommits[0]).toMatchObject({ branch: CI_BRANCH, expectedHeadSha: null, baseSha: 'b0' });
    expect(github.casCommits[0]!.message).toBe('chore(devdigest): add DevDigest CI review (security-reviewer v3)');
    expect(github.branches.main).toBe('b0'); // the base branch is never written
    expect(github.openedPrs).toEqual([expect.objectContaining({ title: 'Add DevDigest CI review', head: CI_BRANCH, base: 'main' })]);
    expect(res.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(res.installation).toMatchObject({ agent_id: AGENT_ID, repo: REPO, status: 'pending', agent_version: 3, pr_url: res.pr_url });
    expect(installations.rows).toHaveLength(1);
    // the base tree is kept, nothing deleted
    expect(github.trees[github.branches[CI_BRANCH]!]).toMatchObject(BASE_TREE);
  });

  it('re-export after a rename keeps the manifest path, reuses the PR and updates the one row (Q29, G5)', async () => {
    const { service, github, installations, agents } = setup();
    await service.exportPr(WS, AGENT_ID, input());
    installations.rows[0]!.status = 'active';
    agents.get(AGENT_ID)!.name = 'Renamed Agent';
    agents.get(AGENT_ID)!.version = 4;

    const res = await service.exportPr(WS, AGENT_ID, input());
    expect(github.casCommits).toHaveLength(2);
    expect(github.casCommits[1]).toMatchObject({ expectedHeadSha: github.casCommits[0]!.commitSha });
    expect(res.files[0]!.path).toBe('.devdigest/agents/security-reviewer.yaml');
    const tree = github.trees[github.branches[CI_BRANCH]!]!;
    expect(Object.keys(tree).filter((p) => p.startsWith('.devdigest/agents/'))).toEqual(['.devdigest/agents/security-reviewer.yaml']);
    expect(JSON.parse(tree['.devdigest/agents/security-reviewer.yaml']!)).toMatchObject({ name: 'Renamed Agent', version: 4, agent_id: AGENT_ID });
    expect(github.openedPrs).toHaveLength(1);
    expect(installations.rows).toHaveLength(1);
    expect(res.installation).toMatchObject({ status: 'active', agent_version: 4 });
  });

  it('a plain-YAML (non-JSON) manifest owned by this agent is recognised and overwritten in place', async () => {
    const yaml = [
      '# edited by hand',
      'name: Security Reviewer',
      `agent_id: ${AGENT_ID}`,
      'version: 2',
      'model: openai/gpt-4.1',
      'system_prompt: |',
      '  Review this PR.',
      'skills:',
      '  - owasp',
      'ci_fail_on: warning',
      '',
    ].join('\n');
    const { service, github } = setup({
      trees: { b0: { ...BASE_TREE, '.devdigest/agents/sec.yaml': yaml, '.devdigest/skills/owasp.md': 'old', [WORKFLOW_PATH]: 'old' } },
    });
    const res = await service.exportPr(WS, AGENT_ID, input());
    expect(res.files[0]!.path).toBe('.devdigest/agents/sec.yaml');
    const tree = github.trees[github.branches[CI_BRANCH]!]!;
    expect(JSON.parse(tree['.devdigest/agents/sec.yaml']!)).toMatchObject({ agent_id: AGENT_ID, version: 3 });
  });

  it('a manifest owned by this agent already on the base branch (merged earlier) is overwritten in place', async () => {
    const { service, github } = setup({
      trees: { b0: { ...BASE_TREE, '.devdigest/agents/legacy.yml': ownManifest(AGENT_ID, ['owasp']), '.devdigest/skills/owasp.md': 'old', [WORKFLOW_PATH]: 'old', [RUNNER_PATH]: 'old' } },
    });
    const res = await service.exportPr(WS, AGENT_ID, input());
    expect(res.files[0]!.path).toBe('.devdigest/agents/legacy.yml');
    expect(github.casCommits).toHaveLength(1);
  });
});

describe('Q29 conflicts — nothing is written (AC-CI-89, 90, 91)', () => {
  const nothingWritten = (s: ReturnType<typeof setup>) => {
    expect(s.writes()).toEqual([]);
    expect(s.installations.rows).toEqual([]);
  };

  it('a manifest of another agent → 409 ci_manifest_conflict', async () => {
    const s = setup({ trees: { b0: { ...BASE_TREE, '.devdigest/agents/perf.yaml': ownManifest(OTHER_AGENT_ID) } } });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_manifest_conflict', statusCode: 409, details: { paths: ['.devdigest/agents/perf.yaml'] } });
    nothingWritten(s);
  });

  it('an invalid manifest (even with our agent_id) or one without agent_id → 409 ci_manifest_conflict', async () => {
    for (const text of ['name: mine\nagent_id: ' + AGENT_ID + '\n', JSON.stringify({ name: 'x', model: 'm', system_prompt: 'p' })]) {
      const s = setup({ trees: { b0: { ...BASE_TREE, '.devdigest/agents/x.yaml': text } } });
      expect((await caught(s.service.exportPr(WS, AGENT_ID, input()))).code).toBe('ci_manifest_conflict');
      nothingWritten(s);
    }
  });

  it('more than one manifest (base + working branch) → 409 naming both', async () => {
    const s = setup({
      branches: { main: 'b0', [CI_BRANCH]: 'h0' },
      trees: { b0: { '.devdigest/agents/a.yaml': ownManifest(AGENT_ID) }, h0: { '.devdigest/agents/b.yml': ownManifest(AGENT_ID) } },
    });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_manifest_conflict', details: { paths: ['.devdigest/agents/a.yaml', '.devdigest/agents/b.yml'] } });
    nothingWritten(s);
  });

  it('a hand-written workflow without a manifest → 409 ci_file_conflict', async () => {
    const s = setup({ trees: { b0: { ...BASE_TREE, [WORKFLOW_PATH]: 'name: mine' } } });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_file_conflict', statusCode: 409, details: { paths: [WORKFLOW_PATH] } });
    nothingWritten(s);
  });

  it('a newly linked skill whose file exists but is not in the owned manifest → 409 ci_file_conflict', async () => {
    const s = setup({
      trees: { b0: { '.devdigest/agents/security-reviewer.yaml': ownManifest(AGENT_ID, ['other']), '.devdigest/skills/owasp.md': 'someone else' } },
    });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_file_conflict', details: { paths: ['.devdigest/skills/owasp.md'] } });
    nothingWritten(s);
  });

  it('the preview reports the same conflicts', async () => {
    const s = setup({ trees: { b0: { [RUNNER_PATH]: 'foreign' } } });
    expect((await caught(s.service.preview(WS, AGENT_ID, input()))).code).toBe('ci_file_conflict');
  });

  it('YAML that is not this agent’s, not valid YAML, or unsafe → 409 ci_manifest_conflict', async () => {
    const yamlOf = (agentId: string) =>
      `name: Hand written\nagent_id: ${agentId}\nmodel: openai/gpt-4.1\nsystem_prompt: |\n  Review.\nskills: []\n`;
    for (const text of [
      yamlOf(OTHER_AGENT_ID), // valid YAML manifest of another agent
      'name: [unclosed\nagent_id: ' + AGENT_ID, // invalid YAML
      `name: Aliased\nagent_id: ${AGENT_ID}\nprompt_text: &p Review.\nsystem_prompt: *p\nmodel: m\n`, // aliases are refused
      `${yamlOf(AGENT_ID)}---\nname: second\n`, // several documents
      `${yamlOf(AGENT_ID)}# ${'x'.repeat(256 * 1024)}\n`, // over 256 KB
    ]) {
      const s = setup({ trees: { b0: { ...BASE_TREE, '.devdigest/agents/hand.yaml': text } } });
      expect((await caught(s.service.exportPr(WS, AGENT_ID, input()))).code).toBe('ci_manifest_conflict');
      nothingWritten(s);
    }
  });

  it('devdigest/ci moved between inspection and commit → 409 ci_concurrent_change, no PR, no row', async () => {
    const s = setup({ beforeRefWrite: (gh) => gh.moveBranch(CI_BRANCH, 'someone-else') });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_concurrent_change', statusCode: 409 });
    expect(s.github.openedPrs).toEqual([]);
    expect(s.installations.rows).toEqual([]);
  });
});

describe('an open devdigest/ci PR (reuse vs base mismatch)', () => {
  const seedPr = (s: ReturnType<typeof setup>, base: string) =>
    s.github.openedPrs.push({ title: 'Add DevDigest CI review', head: CI_BRANCH, base, body: 'existing' });

  it('an open PR into the same base is reused: one commit, no new PR', async () => {
    const s = setup();
    seedPr(s, 'main');
    const res = await s.service.exportPr(WS, AGENT_ID, input());
    expect(res.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(s.github.casCommits).toHaveLength(1);
    expect(s.github.openedPrs).toHaveLength(1);
  });

  it('an open PR into another base → 409 ci_pr_base_mismatch before any commit or DB write; the PR is untouched', async () => {
    const s = setup();
    seedPr(s, 'develop');
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({
      code: 'ci_pr_base_mismatch',
      statusCode: 409,
      details: { pr_url: 'https://github.com/mock/mock/pull/1', pr_base: 'develop', requested_base: 'main' },
    });
    expect(s.github.casCommits).toEqual([]);
    expect(s.github.openedPrs).toEqual([{ title: 'Add DevDigest CI review', head: CI_BRANCH, base: 'develop', body: 'existing' }]);
    expect(s.installations.rows).toEqual([]);
  });

  it('exporting with that PR’s base explicitly works and reuses it', async () => {
    const s = setup({ branches: { main: 'b0', develop: 'd0' }, trees: { b0: {}, d0: {} } });
    seedPr(s, 'develop');
    await s.service.exportPr(WS, AGENT_ID, input({ repo: REPO, base: 'develop' }));
    expect(s.github.casCommits).toEqual([expect.objectContaining({ baseSha: 'd0' })]);
    expect(s.github.openedPrs).toHaveLength(1);
  });
});

describe('occupancy, scoping, validation (G2, AC-CI-33, 35, 37)', () => {
  it('another agent’s installation → 409 ci_repo_has_agent before any GitHub call', async () => {
    const s = setup();
    await s.service.exportZip(WS, OTHER_AGENT_ID, input());
    s.github.calls.length = 0;
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'ci_repo_has_agent', statusCode: 409, details: { agent_id: OTHER_AGENT_ID, agent_name: 'Perf Reviewer' } });
    expect(err.message).toContain('Perf Reviewer');
    expect(s.github.calls).toEqual([]);
  });

  it('an agent of another workspace → 404; a repo outside the workspace → 422; neither touches GitHub', async () => {
    const s = setup();
    expect((await caught(s.service.exportPr(OTHER_WS, AGENT_ID, input()))).statusCode).toBe(404);
    expect((await caught(s.service.preview(WS, AGENT_ID, input({ repo: 'evil/repo' })))).statusCode).toBe(422);
    await expect(s.service.listForAgent(OTHER_WS, AGENT_ID)).rejects.toMatchObject({ statusCode: 404 });
    expect(s.github.calls).toEqual([]);
  });

  it('an edited workflow is honoured; pull_request_target or other edited paths → 422 before GitHub', async () => {
    const s = setup();
    const edited = 'name: edited\non:\n  pull_request:\n';
    const res = await s.service.exportPr(WS, AGENT_ID, input({ repo: REPO, files: [{ path: WORKFLOW_PATH, contents: edited }] }));
    expect(res.files.at(-1)!.contents).toBe(edited);
    s.github.calls.length = 0;
    const bad = await caught(s.service.preview(WS, AGENT_ID, input({ repo: REPO, files: [{ path: WORKFLOW_PATH, contents: 'on: pull_request_target' }] })));
    expect(bad.statusCode).toBe(422);
    expect((await caught(s.service.preview(WS, AGENT_ID, input({ repo: REPO, files: [{ path: RUNNER_PATH, contents: 'x' }] })))).statusCode).toBe(422);
    expect(s.github.calls).toEqual([]);
  });

  it('only GitHub Actions and action open_pr are accepted', async () => {
    const s = setup();
    expect((await caught(s.service.preview(WS, AGENT_ID, input({ repo: REPO, target: 'jenkins' })))).statusCode).toBe(422);
    expect((await caught(s.service.exportPr(WS, AGENT_ID, input({ repo: REPO, action: 'files' })))).statusCode).toBe(422);
  });

  it('a missing runner bundle fails with ci_runner_bundle_missing before any GitHub call (AC-CI-38)', async () => {
    const s = setup();
    const missing = new AppError('ci_runner_bundle_missing', 'Run `cd agent-runner && pnpm build`', 500);
    const service = new CiService({} as never, {
      installations: s.installations,
      agents: { getById: async () => ({ id: AGENT_ID, name: 'A', version: 1 }) as never, effectiveSkills: async () => [] },
      repos: { findByFullName: async () => ({ fullName: REPO, owner: 'acme', name: 'widgets' }) as never },
      github: async () => s.github,
      readBundle: async () => Promise.reject(missing),
      locks: new RepoLocks(),
    });
    expect((await caught(service.preview(WS, AGENT_ID, input()))).code).toBe('ci_runner_bundle_missing');
    expect(s.github.calls).toEqual([]);
  });
});

describe('GitHub failures and partial success (AC-CI-34)', () => {
  it.each([
    ['getDefaultBranch', 401],
    ['getDefaultBranch', 404],
    ['listDirectory', 403],
    ['commitFilesIfUnchanged', 502],
  ] as const)('%s → HTTP %s becomes a 502 with the GitHub reason and no installation row', async (method, status) => {
    const s = setup({ failWith: { [method]: status } });
    const err = await caught(s.service.exportPr(WS, AGENT_ID, input()));
    expect(err).toMatchObject({ code: 'external_service_error', statusCode: 502, details: { status } });
    expect(err.message).toContain(`HTTP ${status}`);
    expect(s.installations.rows).toEqual([]);
  });

  it('commit landed but the PR failed: nothing is undone; a retry continues on its own manifest', async () => {
    const s = setup();
    s.github.failNextPr = true;
    expect((await caught(s.service.exportPr(WS, AGENT_ID, input()))).statusCode).toBe(502);
    expect(s.github.casCommits).toHaveLength(1);
    expect(s.github.branches[CI_BRANCH]).toBe('mock-commit-1'); // the commit stays, history not rewritten
    expect(s.installations.rows).toEqual([]);

    const res = await s.service.exportPr(WS, AGENT_ID, input());
    expect(s.github.casCommits).toHaveLength(2);
    expect(s.github.casCommits[1]).toMatchObject({ expectedHeadSha: 'mock-commit-1' });
    expect(s.github.openedPrs).toHaveLength(1);
    expect(res.installation.status).toBe('pending');
  });

  it('PR opened but the DB write failed: a retry reuses the PR and writes the one row', async () => {
    const s = setup();
    s.installations.failNextUpsert = true;
    await expect(s.service.exportPr(WS, AGENT_ID, input())).rejects.toThrow('db down');
    expect(s.github.openedPrs).toHaveLength(1);
    const res = await s.service.exportPr(WS, AGENT_ID, input());
    expect(s.github.openedPrs).toHaveLength(1);
    expect(s.installations.rows).toHaveLength(1);
    expect(res.pr_url).toBe('https://github.com/mock/mock/pull/1');
  });
});

describe('zip export (AC-CI-17, 39)', () => {
  it('has exactly the preview files incl. runner package.json, writes nothing to GitHub, upserts a pending row without PR url', async () => {
    const s = setup();
    const preview = await s.service.preview(WS, AGENT_ID, input());
    const zip = await s.service.exportZip(WS, AGENT_ID, input());
    expect(zip.filename).toBe('devdigest-ci-security-reviewer.zip');
    const entries = unzipSync(zip.bytes);
    expect(Object.keys(entries).sort()).toEqual(preview.files.map((f) => f.path).sort());
    for (const f of preview.files) expect(strFromU8(entries[f.path]!)).toBe(f.contents);
    expect(strFromU8(entries[RUNNER_PACKAGE_JSON_PATH]!)).toBe('{"type":"module"}\n');
    expect(s.writes()).toEqual([]);
    expect(s.installations.rows).toEqual([expect.objectContaining({ status: 'pending', prUrl: null })]);
  });
});

describe('no secrets in responses or the zip (AC-CI-29, 75)', () => {
  it('only ${{ secrets.* }} references; no env secret value anywhere', async () => {
    const s = setup();
    const res = await s.service.exportPr(WS, AGENT_ID, input());
    const zip = await s.service.exportZip(WS, AGENT_ID, input());
    const zipText = Object.values(unzipSync(zip.bytes)).map((b) => strFromU8(b)).join('\n');
    const prBodies = s.github.openedPrs.map((p) => p.body).join('\n');
    for (const text of [JSON.stringify(res), zipText, prBodies, JSON.stringify(await s.service.listForRepo(WS, REPO))]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{10,}/);
    }
    const workflow = res.files.find((f) => f.path === WORKFLOW_PATH)!.contents;
    expect(workflow.match(/secrets\.\w+/g)).toEqual(['secrets.OPENROUTER_API_KEY', 'secrets.GITHUB_TOKEN']);
  });
});

describe('per-repo lock (§8 step 1)', () => {
  it('two concurrent exports of different agents to one repo: one installs, the other gets ci_repo_has_agent', async () => {
    const s = setup();
    const results = await Promise.allSettled([s.service.exportPr(WS, AGENT_ID, input()), s.service.exportPr(WS, OTHER_AGENT_ID, input())]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as AppError).code).toBe('ci_repo_has_agent');
    expect(s.github.casCommits).toHaveLength(1);
    expect(s.installations.rows).toHaveLength(1);
  });

  it('RepoLocks serialises per key (case-insensitive), releases on error and forgets idle keys', async () => {
    const locks = new RepoLocks();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = locks.run('Acme/X', async () => {
      order.push('a-start');
      await gate;
      order.push('a-end');
      throw new Error('boom');
    });
    const b = locks.run('acme/x', async () => {
      order.push('b');
    });
    const c = locks.run('acme/other', async () => {
      order.push('c');
    });
    await c;
    release();
    await expect(a).rejects.toThrow('boom');
    await b;
    expect(order).toEqual(['a-start', 'c', 'a-end', 'b']);
    expect(locks.size).toBe(0);
  });
});

describe('routes — validation at the edge (no DB)', () => {
  async function app() {
    const f = Fastify();
    f.setValidatorCompiler(validatorCompiler);
    f.setSerializerCompiler(serializerCompiler);
    f.decorate('container', { auth: { currentUser: async () => ({ id: 'u' }), currentWorkspace: async () => ({ id: WS }) } } as never);
    f.setErrorHandler((err, _req, reply) => {
      reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { code: (err as { code?: string }).code } });
    });
    await f.register(ciRoutes);
    return f;
  }

  it('a non-uuid agent id, a bad repo query or a bad body → 422/400 before the service', async () => {
    const f = await app();
    const bad = [
      await f.inject({ method: 'POST', url: '/agents/not-a-uuid/ci/preview', payload: { repo: REPO } }),
      await f.inject({ method: 'GET', url: '/ci/installations?repo=no-slash' }),
      await f.inject({ method: 'GET', url: '/ci/installations' }),
      await f.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: { repo: REPO, triggers: ['closed'] } }),
      await f.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci/zip`, payload: { repo: 'nope' } }),
    ];
    for (const res of bad) expect(res.statusCode).toBeGreaterThanOrEqual(400);
    for (const res of bad) expect(res.statusCode).toBeLessThan(500);
    await f.close();
  });
});
