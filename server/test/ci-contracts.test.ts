import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AgentManifest,
  CiErrorCode,
  CiExportInput,
  CiInstallation,
  CiInstallationView,
  CiPreview,
  CiResultArtifact,
  CiRun,
  CiSyncInput,
  CiSyncResult,
} from '@devdigest/shared';

/**
 * L07 B1 — Export-to-CI contracts (specs/export-to-ci.md §6.2): the new
 * schemas, backward compatibility with manifests / artifacts / runs written
 * before L07, and byte-identity of the L07-CI block in both vendored copies.
 * No DB, no network.
 */

const AGENT_ID = '7d6f3c1e-2b4a-4c8e-9f10-123456789abc';

describe('vendored contract parity (L07-CI)', () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const block = (src: string) => {
    const begin = src.indexOf('// L07-CI:BEGIN');
    const end = src.indexOf('// L07-CI:END');
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    return src.slice(begin, end);
  };
  const server = read('../src/vendor/shared/contracts/eval-ci.ts');
  const client = read('../../client/src/vendor/shared/contracts/eval-ci.ts');

  it('the L07-CI block of eval-ci.ts is identical in the server and client copies', () => {
    expect(block(client)).toBe(block(server));
  });

  it('both copies declare AgentManifest and import CiFailOn for it', () => {
    for (const src of [server, client]) {
      expect(block(src)).toContain('export const AgentManifest = z.object({');
      expect(src).toMatch(/import \{[^}]*\bCiFailOn\b[^}]*\} from '\.\/knowledge\.js';/);
    }
  });
});

describe('AgentManifest (AC-CI-21)', () => {
  // The shape the runner has read since L06 — no agent_id, no version.
  const legacy = { name: 'Security', model: 'openai/gpt-4.1', system_prompt: 'review' };

  it('a pre-L07 manifest still validates with the same defaults', () => {
    const m = AgentManifest.parse(legacy);
    expect(m).toEqual({
      ...legacy,
      provider: 'openrouter',
      skills: [],
      strategy: 'auto',
      ci_fail_on: 'critical',
    });
    expect(m.agent_id).toBeUndefined();
    expect(m.version).toBeUndefined();
  });

  it('a generated manifest carries agent_id and version', () => {
    const m = AgentManifest.parse({ ...legacy, agent_id: AGENT_ID, version: 3, skills: ['owasp'] });
    expect(m).toMatchObject({ agent_id: AGENT_ID, version: 3, skills: ['owasp'] });
  });

  it('keeps tolerating unknown keys and a null skills list (runner compatibility)', () => {
    expect(AgentManifest.parse({ ...legacy, skills: null, extra: 'x' })).not.toHaveProperty('extra');
    expect(AgentManifest.parse({ ...legacy, skills: null }).skills).toEqual([]);
  });

  it('rejects an empty agent_id and a non-integer or negative version', () => {
    expect(AgentManifest.safeParse({ ...legacy, agent_id: '' }).success).toBe(false);
    expect(AgentManifest.safeParse({ ...legacy, version: 1.5 }).success).toBe(false);
    expect(AgentManifest.safeParse({ ...legacy, version: -1 }).success).toBe(false);
  });
});

describe('CiResultArtifact (AC-CI-81)', () => {
  // Exactly the fields agent-runner's buildResultArtifact writes today (RUNNER_VERSION '1').
  const v1 = {
    findings_count: 3,
    critical: 1,
    warning: 1,
    suggestion: 1,
    cost_usd: 0.0123,
    duration_ms: 4200,
    agent: 'Security',
    version: '1',
    pr_number: 42,
  };

  it('an artifact of an older runner bundle still validates; the new fields read as absent', () => {
    const a = CiResultArtifact.parse(v1);
    expect(a).toEqual(v1);
    expect([a.model, a.manifest_version, a.gate_triggered, a.blockers, a.skills]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('an extended artifact carries model, manifest_version, gate_triggered, blockers and skills', () => {
    const ext = {
      ...v1,
      model: 'openai/gpt-4.1',
      manifest_version: 3,
      gate_triggered: true,
      blockers: 1,
      skills: ['owasp', 'sql'],
    };
    expect(CiResultArtifact.parse(ext)).toEqual(ext);
  });

  it('accepts an unknown cost (null) and rejects negative numbers (untrusted on ingest, §5)', () => {
    expect(CiResultArtifact.safeParse({ ...v1, cost_usd: null }).success).toBe(true);
    for (const bad of [
      { findings_count: -1 },
      { cost_usd: -0.01 },
      { duration_ms: -5 },
      { blockers: -1 },
      { pr_number: -2 },
      { manifest_version: -1 },
    ]) {
      expect(CiResultArtifact.safeParse({ ...v1, ...bad }).success).toBe(false);
    }
  });

  it('rejects wrongly typed L07 fields', () => {
    expect(CiResultArtifact.safeParse({ ...v1, skills: 'owasp' }).success).toBe(false);
    expect(CiResultArtifact.safeParse({ ...v1, gate_triggered: 'yes' }).success).toBe(false);
  });
});

describe('CiExportInput (AC-CI-35, 80; §6.2)', () => {
  it('defaults: target gha, open_pr, post_as pr_comment, all three triggers, no base, no files', () => {
    const input = CiExportInput.parse({ repo: 'acme/payments-api' });
    expect(input).toEqual({
      repo: 'acme/payments-api',
      target: 'gha',
      action: 'open_pr',
      post_as: 'pr_comment',
      triggers: ['opened', 'synchronize', 'reopened'],
    });
    expect('base' in input).toBe(false);
  });

  it('accepts a base branch and edited files', () => {
    const input = CiExportInput.parse({
      repo: 'acme/api.v2',
      base: 'develop',
      triggers: ['opened'],
      post_as: 'none',
      files: [{ path: '.github/workflows/devdigest-review.yml', contents: 'name: x' }],
    });
    expect(input.base).toBe('develop');
    expect(input.files).toEqual([
      { path: '.github/workflows/devdigest-review.yml', contents: 'name: x', editable: true },
    ]);
  });

  it('rejects a repo that is not owner/name', () => {
    for (const repo of ['acme', 'acme/', '/api', 'acme/api/extra', 'acme api/x', '']) {
      expect(CiExportInput.safeParse({ repo }).success).toBe(false);
    }
  });

  it('rejects triggers outside {opened, synchronize, reopened} and an empty trigger list', () => {
    expect(CiExportInput.safeParse({ repo: 'a/b', triggers: ['closed'] }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b', triggers: ['pull_request_target'] }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b', triggers: [] }).success).toBe(false);
  });

  it('rejects an empty base and an unknown post_as', () => {
    expect(CiExportInput.safeParse({ repo: 'a/b', base: '' }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b', post_as: 'slack' }).success).toBe(false);
  });
});

describe('installations, preview and runs (§6.2, G4)', () => {
  const installation = {
    id: 'i1',
    agent_id: AGENT_ID,
    repo: 'acme/payments-api',
    target_type: 'gha',
    installed_at: '2026-10-23T10:00:00.000Z',
    status: 'pending',
    agent_version: 3,
    pr_url: 'https://github.com/acme/payments-api/pull/7',
    updated_at: '2026-10-23T10:00:00.000Z',
    last_synced_at: null,
  };

  it('CiInstallation mirrors the 0016 columns; status is pending | active | error', () => {
    expect(CiInstallation.parse(installation)).toEqual(installation);
    expect(CiInstallation.safeParse({ ...installation, status: 'removed' }).success).toBe(false);
    expect(CiInstallation.safeParse({ ...installation, pr_url: null, agent_version: null }).success).toBe(true);
  });

  it('CiInstallationView adds agent_name and the last run (AC-CI-62, 86)', () => {
    const view = { ...installation, agent_name: 'Security', last_run_status: null, last_run_at: null };
    expect(CiInstallationView.parse(view)).toEqual(view);
    const { agent_name: _omit, ...withoutName } = view;
    expect(CiInstallationView.safeParse(withoutName).success).toBe(false);
  });

  it('CiPreview is the list of generated files', () => {
    expect(CiPreview.parse({ files: [{ path: 'a', contents: 'b', editable: false }] })).toEqual({
      files: [{ path: 'a', contents: 'b', editable: false }],
    });
  });

  it('a CiRun without the L07 fields still validates; with them it carries repo, SHA, verdict, run id', () => {
    const legacy = {
      id: 'r1',
      ci_installation_id: 'i1',
      pr_number: 42,
      ran_at: '2026-10-23T10:00:00.000Z',
      status: 'succeeded',
      findings_count: 2,
      cost_usd: null,
      github_url: 'https://github.com/acme/payments-api/actions/runs/1',
      source: 'ci',
    };
    expect(CiRun.parse(legacy)).toEqual(legacy);
    const full = { ...legacy, repo: 'acme/payments-api', commit_sha: 'a1b2c3d', verdict: 'blocked', agent_run_id: 'run-1' };
    expect(CiRun.parse(full)).toEqual(full);
    expect(CiRun.safeParse({ ...legacy, verdict: 'green' }).success).toBe(false);
  });
});

describe('sync and error codes (§6.1, §7)', () => {
  it('CiSyncInput needs a mode; installation_id must be a uuid', () => {
    expect(CiSyncInput.parse({ mode: 'auto' })).toEqual({ mode: 'auto' });
    expect(CiSyncInput.parse({ mode: 'manual', installation_id: AGENT_ID }).installation_id).toBe(AGENT_ID);
    expect(CiSyncInput.safeParse({}).success).toBe(false);
    expect(CiSyncInput.safeParse({ mode: 'often' }).success).toBe(false);
    expect(CiSyncInput.safeParse({ mode: 'manual', installation_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('CiSyncResult reports counts, skipped runs with a reason, and per-installation errors', () => {
    const result = {
      ingested: 2,
      throttled: 1,
      skipped: [{ installation_id: 'i1', github_run_id: 99, reason: 'pr_mismatch' }],
      errors: [{ installation_id: 'i2', repo: 'acme/web', message: 'GitHub 404' }],
    };
    expect(CiSyncResult.parse(result)).toEqual(result);
    expect(CiSyncResult.safeParse({ ...result, ingested: -1 }).success).toBe(false);
  });

  it('CiErrorCode lists exactly the ci error codes', () => {
    expect(CiErrorCode.options).toEqual([
      'ci_repo_has_agent',
      'ci_manifest_conflict',
      'ci_file_conflict',
      'ci_concurrent_change',
      'ci_pr_base_mismatch',
      'ci_runner_bundle_missing',
    ]);
  });
});
