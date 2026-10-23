import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentManifest } from '@devdigest/shared';
import { AppError, ConfigError, ValidationError } from '../src/platform/errors.js';
import { loadConfig } from '../src/platform/config.js';
import {
  MAX_WORKFLOW_BYTES,
  PINNED_ACTIONS,
  RUNNER_PACKAGE_JSON_PATH,
  RUNNER_PATH,
  WORKFLOW_PATH,
  type ActionKey,
  type PinnedAction,
} from '../src/modules/ci/constants.js';
import {
  assertManifestPath,
  buildManifest,
  manifestModel,
  slugify,
  type ManifestAgent,
} from '../src/modules/ci/manifest.js';
import { assertEditedWorkflow, renderWorkflow, type WorkflowOptions } from '../src/modules/ci/workflow.js';
import { readRunnerBundle } from '../src/modules/ci/bundle.js';
import { buildCiFiles, workflowOverride } from '../src/modules/ci/helpers.js';

/**
 * L07 B4 — Export-to-CI generators (specs/export-to-ci.md FR-4, §9;
 * AC-CI-20..29, 38, 78, 83; TA1). Pure functions, a temp bundle file, no
 * network. The action SHAs below are FAKE test fixtures that only satisfy the
 * 40-hex format; the real pins live in PINNED_ACTIONS and must be confirmed.
 */

const FAKE_ACTIONS: Record<ActionKey, PinnedAction> = {
  checkout: { uses: 'actions/checkout', sha: 'a'.repeat(40), tag: 'v4' },
  setupNode: { uses: 'actions/setup-node', sha: 'b'.repeat(40), tag: 'v4' },
  uploadArtifact: { uses: 'actions/upload-artifact', sha: 'c'.repeat(40), tag: 'v4' },
};

const AGENT: ManifestAgent = {
  id: '7d6f3c1e-2b4a-4c8e-9f10-123456789abc',
  name: 'Security Reviewer',
  version: 3,
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'Review this PR for security issues.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};
const SKILLS = [
  { name: 'OWASP Top 10', body: '# OWASP\nFlag injection.' },
  { name: 'No TODOs', body: 'Flag new TODO comments.' },
];

const expectValidation = (fn: () => unknown, message: RegExp) => {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as ValidationError).statusCode).toBe(422);
  expect((err as Error).message).toMatch(message);
};

const workflow = (over: Partial<WorkflowOptions> = {}) =>
  renderWorkflow({
    triggers: ['opened', 'synchronize'],
    postAs: 'pr_comment',
    agentSlug: 'security-reviewer',
    agentVersion: 3,
    actions: FAKE_ACTIONS,
    ...over,
  });

/** Lines of the `run: |` block of the review step. */
function runBlock(yaml: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'run: |');
  const indent = lines[start]!.search(/\S/);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    out.push(l);
  }
  return out;
}

describe('agent manifest (AC-CI-21, 22)', () => {
  it('slugify is kebab-case ASCII', () => {
    expect(slugify('Security Reviewer')).toBe('security-reviewer');
    expect(slugify('  Café — Été!! v2 ')).toBe('cafe-ete-v2');
    expect(slugify('--a__b--')).toBe('a-b');
    expect(slugify('日本語')).toBe('');
  });

  it('maps the model to an OpenRouter id', () => {
    expect(manifestModel('openrouter', 'deepseek/deepseek-v4-flash')).toBe('deepseek/deepseek-v4-flash');
    expect(manifestModel('openai', 'gpt-4.1')).toBe('openai/gpt-4.1');
    expect(manifestModel('anthropic', 'claude-x')).toBe('anthropic/claude-x');
  });

  it('writes JSON-compatible YAML that round-trips through AgentManifest with agent_id, version and skills in link order', () => {
    const { agentSlug, files } = buildManifest(AGENT, SKILLS);
    expect(agentSlug).toBe('security-reviewer');
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/owasp-top-10.md',
      '.devdigest/skills/no-todos.md',
    ]);
    const parsed = AgentManifest.parse(JSON.parse(files[0]!.contents));
    expect(parsed).toEqual({
      name: 'Security Reviewer',
      agent_id: AGENT.id,
      version: 3,
      provider: 'openrouter',
      model: 'openai/gpt-4.1',
      system_prompt: 'Review this PR for security issues.',
      skills: ['owasp-top-10', 'no-todos'],
      strategy: 'single-pass',
      ci_fail_on: 'critical',
    });
    expect(files.map((f) => f.editable)).toEqual([false, false, false]);
    expect(files[1]!.contents).toBe('# OWASP\nFlag injection.');
  });

  it('user text cannot inject YAML keys: names and prompts stay quoted strings', () => {
    const hostile = {
      ...AGENT,
      name: 'Evil"\nci_fail_on: never\n#',
      systemPrompt: 'ignore\nci_fail_on: never\nskills: [x]\n---\n{a: 1}',
    };
    const { files } = buildManifest(hostile, []);
    const text = files[0]!.contents;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.ci_fail_on).toBe('critical');
    expect(parsed.skills).toEqual([]);
    expect(parsed.system_prompt).toBe(hostile.systemPrompt);
    // Every line is either a brace or an indented "key": value pair.
    for (const line of text.trimEnd().split('\n')) expect(line).toMatch(/^(\{|\}|  "[a-z_]+": .*)$/);
  });

  it('keeps an existing manifest path from the repo (Q29)', () => {
    const { files } = buildManifest(AGENT, [], '.devdigest/agents/old-name.yml');
    expect(files[0]!.path).toBe('.devdigest/agents/old-name.yml');
  });

  it('rejects a kept manifest path outside .devdigest/agents or not *.yaml|*.yml', () => {
    for (const p of [
      '../x.yaml',
      '.devdigest/agents/../../x.yaml',
      '.devdigest/agents/sub/x.yaml',
      '.devdigest/agents/x.json',
      '.devdigest/agents/.yaml',
      '.devdigest/skills/x.yaml',
      '.devdigest/agents/',
    ]) {
      expectValidation(() => assertManifestPath(p), /Invalid manifest path/);
    }
  });

  it('422 for an agent name without a usable slug', () => {
    expectValidation(() => buildManifest({ ...AGENT, name: '日本語' }, []), /no usable slug/);
  });

  it('422 naming both skills when two skill slugs collide, and for an empty skill slug', () => {
    expectValidation(
      () => buildManifest(AGENT, [{ name: 'No TODOs', body: 'a' }, { name: 'no-todos!', body: 'b' }]),
      /"No TODOs" and "no-todos!".*"no-todos"/,
    );
    expectValidation(() => buildManifest(AGENT, [{ name: '???', body: 'a' }]), /Skill "\?\?\?" has no usable slug/);
  });

  it('422 when the agent cannot form a valid manifest (e.g. empty model)', () => {
    expectValidation(() => buildManifest({ ...AGENT, model: '' }, []), /invalid manifest/);
  });
});

describe('workflow (AC-CI-23..29, 78; §9)', () => {
  it('uses the confirmed pins by default: release tag + full commit SHA (user-confirmed 2026-10-23)', () => {
    expect(PINNED_ACTIONS).toEqual({
      checkout: { uses: 'actions/checkout', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', tag: 'v7.0.1' },
      setupNode: { uses: 'actions/setup-node', sha: '949feb2413d6458794dcd2491c4babbbce0c15c1', tag: 'v7.1.0' },
      uploadArtifact: { uses: 'actions/upload-artifact', sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9', tag: 'v7.0.2' },
    });
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'pr_comment', agentSlug: 'a', agentVersion: 1 });
    expect(yaml).toContain('uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n');
    expect(yaml).toContain('uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n');
    expect(yaml).toContain('uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n');
  });

  it('refuses to generate with an unconfirmed (null or non-SHA) pin', () => {
    let err: unknown;
    try {
      workflow({ actions: { ...FAKE_ACTIONS, setupNode: { ...FAKE_ACTIONS.setupNode, sha: null } } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain('actions/setup-node');
    expect(() => workflow({ actions: { ...FAKE_ACTIONS, checkout: { ...FAKE_ACTIONS.checkout, sha: 'v4' } } })).toThrow(
      /actions\/checkout/,
    );
  });

  it('AC-CI-23: triggers only on pull_request with the selected types, never pull_request_target', () => {
    const yaml = workflow({ triggers: ['reopened', 'opened'] });
    const on = yaml.slice(yaml.indexOf('\non:\n'), yaml.indexOf('\npermissions:'));
    expect(on).toBe('\non:\n  pull_request:\n    types: [opened, reopened]\n');
    expect(yaml).not.toContain('pull_request_target');
    expect(workflow({ triggers: ['opened', 'synchronize', 'reopened'] })).toContain('types: [opened, synchronize, reopened]');
    expectValidation(() => workflow({ triggers: [] }), /at least one trigger/);
  });

  it('AC-CI-24: contents read + pull-requests write, or read when post_as is none — no other scope', () => {
    const block = (y: string) => y.slice(y.indexOf('\npermissions:\n'), y.indexOf('\njobs:'));
    expect(block(workflow())).toBe('\npermissions:\n  contents: read\n  pull-requests: write\n');
    expect(block(workflow({ postAs: 'github_review' }))).toBe('\npermissions:\n  contents: read\n  pull-requests: write\n');
    expect(block(workflow({ postAs: 'none' }))).toBe('\npermissions:\n  contents: read\n  pull-requests: read\n');
    expect(workflow().match(/^\s*permissions:/gm)).toHaveLength(1);
  });

  it('AC-CI-25: every uses: is pinned to a 40-hex SHA; no devdigest/review-action', () => {
    const uses = workflow().split('\n').filter((l) => l.trim().startsWith('uses:'));
    expect(uses).toHaveLength(3);
    for (const l of uses) expect(l).toMatch(/uses: actions\/[a-z-]+@[0-9a-f]{40} # v4$/);
    expect(workflow()).not.toContain('review-action');
  });

  it('AC-CI-26: runs the bundled runner with exactly the four env values; secrets only via ${{ secrets.* }}', () => {
    const yaml = workflow({ postAs: 'github_review' });
    const env = yaml.slice(yaml.indexOf('        env:\n'), yaml.indexOf('        run: |'));
    expect(env).toBe(
      [
        '        env:',
        '          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}',
        '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
        '          PR_NUMBER: ${{ github.event.pull_request.number }}',
        '          DEVDIGEST_POST_AS: github_review',
        '',
      ].join('\n'),
    );
    expect(runBlock(yaml).join('\n')).toContain(`node ${RUNNER_PATH}`);
    expect(yaml.match(/secrets\./g)).toHaveLength(2);
  });

  it('AC-CI-27: the job is skipped for fork PRs', () => {
    expect(workflow()).toContain('    if: github.event.pull_request.head.repo.full_name == github.repository\n');
  });

  it('AC-CI-78: checks out the base SHA without persisted credentials and skips with a notice when the runner is absent', () => {
    const yaml = workflow();
    expect(yaml).toContain('          ref: ${{ github.event.pull_request.base.sha }}\n          persist-credentials: false\n');
    expect(runBlock(yaml).map((l) => l.trim())).toEqual([
      `if [ ! -f ${RUNNER_PATH} ]; then`,
      `echo "::notice::DevDigest runner not found on the base branch (${RUNNER_PATH}); skipping the review."`,
      'exit 0',
      'fi',
      `node ${RUNNER_PATH}`,
    ]);
  });

  it('AC-CI-28: uploads devdigest-result.json as devdigest-result even on failure, ignoring a missing file', () => {
    const yaml = workflow();
    const upload = yaml.slice(yaml.indexOf('      - name: Upload DevDigest result'));
    expect(upload).toBe(
      [
        '      - name: Upload DevDigest result',
        '        if: always()',
        `        uses: actions/upload-artifact@${'c'.repeat(40)} # v4`,
        '        with:',
        '          name: devdigest-result',
        '          path: devdigest-result.json',
        '          if-no-files-found: ignore',
        '',
      ].join('\n'),
    );
  });

  it('AC-CI-29: no ${{ }} expression inside the run: script', () => {
    expect(runBlock(workflow()).join('\n')).not.toContain('${{');
  });

  it('is versioned and deterministic; header values are validated', () => {
    const yaml = workflow();
    expect(yaml.split('\n')[0]).toBe('# Generated by DevDigest — workflow template v1, agent "security-reviewer" v3.');
    expect(workflow()).toBe(yaml);
    expectValidation(() => workflow({ agentSlug: 'evil"\nname: x' }), /Invalid agent slug/);
    expectValidation(() => workflow({ agentVersion: 1.5 }), /Invalid agent version/);
  });

  it('AC-CI-83: an edited workflow is limited to 64 KB of UTF-8 and may not use pull_request_target', () => {
    expect(() => assertEditedWorkflow('x'.repeat(MAX_WORKFLOW_BYTES))).not.toThrow();
    expectValidation(() => assertEditedWorkflow('x'.repeat(MAX_WORKFLOW_BYTES + 1)), /65537 bytes; the limit is 65536/);
    // 32 769 characters but 65 538 bytes: the limit counts UTF-8 bytes.
    expectValidation(() => assertEditedWorkflow('é'.repeat(32_769)), /65538 bytes/);
    expectValidation(() => assertEditedWorkflow('on:\n  pull_request_target:\n'), /pull_request_target/);
  });
});

describe('runner bundle (AC-CI-38, TA1)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'devdigest-ci-bundle-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the bundle text unchanged', async () => {
    const path = join(dir, 'index.js');
    writeFileSync(path, '#!/usr/bin/env node\nconsole.log("é");\n');
    expect(await readRunnerBundle(path)).toBe('#!/usr/bin/env node\nconsole.log("é");\n');
  });

  it('a missing bundle → ci_runner_bundle_missing naming `cd agent-runner && pnpm build`', async () => {
    const err = await readRunnerBundle(join(dir, 'missing.js')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('ci_runner_bundle_missing');
    expect((err as Error).message).toContain('cd agent-runner && pnpm build');
  });

  it('other read errors are not disguised as a missing bundle', async () => {
    const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
    await expect(readRunnerBundle('/x', async () => Promise.reject(eacces))).rejects.toBe(eacces);
  });

  it('the default path is <repo root>/agent-runner/dist/index.js, not relative to the cwd', () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const expected = resolve(repoRoot, 'agent-runner', 'dist', 'index.js');
    expect(loadConfig({ NODE_ENV: 'test' }).ciRunnerBundlePath).toBe(expected);
    expect(loadConfig({ NODE_ENV: 'test', DEVDIGEST_RUNNER_BUNDLE: '' }).ciRunnerBundlePath).toBe(expected);
    expect(expected).not.toBe(resolve(process.cwd(), 'agent-runner', 'dist', 'index.js'));
  });

  it('DEVDIGEST_RUNNER_BUNDLE: absolute as given, relative against the working directory', () => {
    const abs = resolve(dir, 'custom.js');
    expect(loadConfig({ NODE_ENV: 'test', DEVDIGEST_RUNNER_BUNDLE: abs }).ciRunnerBundlePath).toBe(abs);
    expect(loadConfig({ NODE_ENV: 'test', DEVDIGEST_RUNNER_BUNDLE: 'build/r.js' }).ciRunnerBundlePath).toBe(
      resolve(process.cwd(), 'build/r.js'),
    );
  });
});

describe('the exported file set (AC-CI-20, 07, 26)', () => {
  const BUNDLE = '/* bundled runner */\nconsole.log(1);\n';
  const input = { triggers: ['opened', 'synchronize'] as const, post_as: 'pr_comment' as const };
  const build = (over: Partial<Parameters<typeof buildCiFiles>[0]> = {}) =>
    buildCiFiles({
      agent: AGENT,
      skills: SKILLS,
      input: { ...input, triggers: [...input.triggers] },
      runnerBundle: BUNDLE,
      actions: FAKE_ACTIONS,
      ...over,
    });

  it('is exactly manifest, skills in link order, runner, runner package.json, workflow — only the workflow editable, no memory.jsonl', () => {
    const files = build();
    expect(files.map((f) => [f.path, f.editable])).toEqual([
      ['.devdigest/agents/security-reviewer.yaml', false],
      ['.devdigest/skills/owasp-top-10.md', false],
      ['.devdigest/skills/no-todos.md', false],
      [RUNNER_PATH, false],
      [RUNNER_PACKAGE_JSON_PATH, false],
      [WORKFLOW_PATH, true],
    ]);
    expect(files.some((f) => f.path.includes('memory'))).toBe(false);
    expect(files.find((f) => f.path === RUNNER_PATH)!.contents).toBe(BUNDLE);
    const pkg = files.find((f) => f.path === RUNNER_PACKAGE_JSON_PATH)!.contents;
    expect(pkg).toBe('{"type":"module"}\n');
    expect(JSON.parse(pkg)).toEqual({ type: 'module' });
  });

  it('the runner package.json makes an ESM runner load even under a root package.json with "type": "commonjs"', () => {
    // A synthetic ESM module stands in for the ncc bundle (dist is gitignored
    // and not built in CI); it uses `export` + `import.meta` like the bundle.
    const repo = mkdtempSync(join(tmpdir(), 'devdigest-ci-repo-'));
    try {
      writeFileSync(join(repo, 'package.json'), '{"name":"target","type":"commonjs"}\n');
      const runnerDir = join(repo, '.devdigest', 'runner');
      mkdirSync(runnerDir, { recursive: true });
      writeFileSync(
        join(runnerDir, 'index.js'),
        'export const url = import.meta.url;\nconsole.log("runner-loaded-as-esm");\n',
      );
      const run = () =>
        spawnSync(process.execPath, [join('.devdigest', 'runner', 'index.js')], { cwd: repo, encoding: 'utf8' });

      // Without the runner package.json the root "commonjs" wins and ESM fails.
      const without = run();
      expect(without.status).not.toBe(0);
      expect(without.stdout).not.toContain('runner-loaded-as-esm');

      const pkg = build().find((f) => f.path === RUNNER_PACKAGE_JSON_PATH)!;
      writeFileSync(join(repo, pkg.path), pkg.contents);
      const withPkg = run();
      expect(withPkg.status).toBe(0);
      expect(withPkg.stdout).toContain('runner-loaded-as-esm');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('is deterministic for the same agent version and input', () => {
    expect(build()).toEqual(build());
  });

  it('uses the kept manifest path (Q29) and an agent without skills', () => {
    const files = build({ skills: [], manifestPath: '.devdigest/agents/legacy.yaml' });
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/legacy.yaml',
      RUNNER_PATH,
      RUNNER_PACKAGE_JSON_PATH,
      WORKFLOW_PATH,
    ]);
  });

  it('an edited workflow replaces the generated one (AC-CI-07)', () => {
    const edited = 'name: my edit\non:\n  pull_request:\n';
    const files = build({ input: { ...input, triggers: ['opened'], files: [{ path: WORKFLOW_PATH, contents: edited, editable: true }] } });
    expect(files.at(-1)).toEqual({ path: WORKFLOW_PATH, contents: edited, editable: true });
  });

  it('refuses edits of other files, duplicates, oversize and pull_request_target', () => {
    const f = (path: string, contents = 'x') => ({ path, contents, editable: true });
    expectValidation(() => workflowOverride([f(RUNNER_PATH)]), /Only \.github\/workflows\/devdigest-review\.yml can be edited/);
    expectValidation(() => workflowOverride([f(WORKFLOW_PATH), f(WORKFLOW_PATH)]), /more than once/);
    expectValidation(() => workflowOverride([f(WORKFLOW_PATH, 'x'.repeat(MAX_WORKFLOW_BYTES + 1))]), /limit is 65536/);
    expectValidation(() => workflowOverride([f(WORKFLOW_PATH, 'on: pull_request_target')]), /pull_request_target/);
    expect(workflowOverride(undefined)).toBeNull();
    expect(workflowOverride([])).toBeNull();
  });
});
