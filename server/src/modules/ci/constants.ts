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

/** Directories read (at the base and `devdigest/ci` SHAs) before an export (§8 step 3). */
export const INSPECTED_DIRS = ['.devdigest/agents', '.devdigest/skills', '.devdigest/runner', '.github/workflows'] as const;

/** A manifest read back from the repo larger than this is treated as not owned. */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/** Title of the export PR (AC-CI-30). */
export const PR_TITLE = 'Add DevDigest CI review';

/** Preview / export / zip each read GitHub; export also writes to it. */
export const CI_EXPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

// ---- CI ingest & sync (B7, §7) ----

/** Newest completed runs read per installation per sync (AC-CI-40). */
export const SYNC_RUNS_PER_INSTALLATION = 20;
/** A manual sync of one installation at most once per this window (AC-CI-56). */
export const MANUAL_SYNC_INTERVAL_MS = 60_000;
/** The downloaded artifact zip and the unzipped result JSON are each capped at this size. */
export const MAX_ARTIFACT_BYTES = 64 * 1024;
/** GET /ci/runs returns at most this many rows (AC-CI-82). */
export const CI_RUNS_LIST_LIMIT = 50;
/** POST /ci/runs/sync reads GitHub for every due installation. */
export const CI_SYNC_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

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
