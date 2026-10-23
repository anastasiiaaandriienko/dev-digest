import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { buildResultArtifact, RUNNER_VERSION, type BuildResultArtifactInput } from './artifact.js';

/**
 * `buildResultArtifact` (AC-26, L07 AC-CI-81): the extended
 * `devdigest-result.json` carries model, manifest_version, gate_triggered,
 * blockers and the manifest skill slugs, and still validates against the
 * shared `CiResultArtifact` contract the studio's ingest parses.
 */

function finding(id: string, severity: Finding['severity']): Finding {
  return {
    id,
    severity,
    category: 'security',
    title: id,
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
  };
}

const BASE: BuildResultArtifactInput = {
  findings: [finding('f1', 'CRITICAL'), finding('f2', 'WARNING'), finding('f3', 'SUGGESTION')],
  costUsd: 0.0123,
  durationMs: 4200,
  agent: 'Security Reviewer',
  prNumber: 42,
  model: 'deepseek/deepseek-v4-flash',
  manifestVersion: 3,
  gateTriggered: true,
  blockers: 1,
  skills: ['secure-config', 'no-todos'],
};

describe('buildResultArtifact', () => {
  it('AC-CI-81: writes the L07 fields next to the counts and validates against CiResultArtifact', () => {
    const artifact = buildResultArtifact(BASE);
    expect(artifact).toEqual({
      findings_count: 3,
      critical: 1,
      warning: 1,
      suggestion: 1,
      cost_usd: 0.0123,
      duration_ms: 4200,
      agent: 'Security Reviewer',
      version: RUNNER_VERSION,
      pr_number: 42,
      model: 'deepseek/deepseek-v4-flash',
      manifest_version: 3,
      gate_triggered: true,
      blockers: 1,
      skills: ['secure-config', 'no-todos'],
    });
    expect(CiResultArtifact.safeParse(JSON.parse(JSON.stringify(artifact))).success).toBe(true);
  });

  it('a manifest without version, no skills, no findings and unknown cost still yields a valid artifact', () => {
    const artifact = buildResultArtifact({
      ...BASE,
      findings: [],
      costUsd: null,
      manifestVersion: null,
      gateTriggered: false,
      blockers: 0,
      skills: [],
    });
    expect(artifact).toMatchObject({
      findings_count: 0,
      cost_usd: null,
      manifest_version: null,
      gate_triggered: false,
      blockers: 0,
      skills: [],
    });
    expect(CiResultArtifact.safeParse(JSON.parse(JSON.stringify(artifact))).success).toBe(true);
  });

  it('keeps the manifest skill order and does not share the caller array', () => {
    const skills = ['b-skill', 'a-skill'];
    const artifact = buildResultArtifact({ ...BASE, skills });
    expect(artifact.skills).toEqual(['b-skill', 'a-skill']);
    expect(artifact.skills).not.toBe(skills);
  });

  it('rejects an inconsistent input instead of writing an invalid artifact', () => {
    expect(() => buildResultArtifact({ ...BASE, blockers: -1 })).toThrow(/CiResultArtifact validation/);
  });
});
