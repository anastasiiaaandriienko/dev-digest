/**
 * Export to CI (L07, specs/export-to-ci.md FR-4, §8, §9) — generated file
 * layout, workflow limits and the pinned third-party actions.
 */

/** Branch the export commits to; the base branch is never written. */
export const CI_BRANCH = 'devdigest/ci';

export const MANIFEST_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const RUNNER_PATH = '.devdigest/runner/index.js';
/**
 * The ncc bundle is ESM. This file makes `.devdigest/runner/` an ES-module
 * package, so the runner loads even when the target repo's root package.json
 * says `"type": "commonjs"` (same content ncc writes next to dist/index.js).
 */
export const RUNNER_PACKAGE_JSON_PATH = '.devdigest/runner/package.json';
export const RUNNER_PACKAGE_JSON = '{"type":"module"}\n';
export const WORKFLOW_FILE = 'devdigest-review.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;

/** What the runner writes (cwd) and the workflow uploads (AC-CI-28). */
export const RESULT_FILE = 'devdigest-result.json';
export const RESULT_ARTIFACT = 'devdigest-result';

/** Edited workflow limit (AC-CI-83): 64 KB of UTF-8. */
export const MAX_WORKFLOW_BYTES = 65_536;

/** Version of the generated workflow template, written into its header. */
export const WORKFLOW_TEMPLATE_VERSION = 1;

export const RUNNER_NODE_VERSION = '22';

export type ActionKey = 'checkout' | 'setupNode' | 'uploadArtifact';

export interface PinnedAction {
  /** `owner/repo` of the action. */
  uses: string;
  /** Full 40-hex commit SHA (AC-CI-25); null = not confirmed yet. */
  sha: string | null;
  /** Release the SHA belongs to, written as a trailing comment. */
  tag: string;
}

/**
 * Third-party actions used by the generated workflow, pinned to full commit
 * SHAs. Each SHA is the commit of the release tag, resolved via the GitHub API
 * (git ref + commits endpoint agreed) and confirmed by the user on 2026-10-23 —
 * never guessed. A null SHA makes `renderWorkflow` refuse (ConfigError).
 */
export const PINNED_ACTIONS: Readonly<Record<ActionKey, PinnedAction>> = {
  checkout: { uses: 'actions/checkout', sha: '3d3c42e5aac5ba805825da76410c181273ba90b1', tag: 'v7.0.1' },
  setupNode: { uses: 'actions/setup-node', sha: '949feb2413d6458794dcd2491c4babbbce0c15c1', tag: 'v7.1.0' },
  uploadArtifact: { uses: 'actions/upload-artifact', sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9', tag: 'v7.0.2' },
};

export const FULL_SHA_RE = /^[0-9a-f]{40}$/;
