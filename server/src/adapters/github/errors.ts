import type { CommitFile } from '@devdigest/shared';

// Dependency-free on purpose: `adapters/mocks.ts` imports these, and
// reviewer-core's tests load the mocks without the server's node_modules.

/**
 * An adapter-raised failure with an HTTP-like `status` for the caller to map.
 * Its message never carries a token or a signed artifact URL.
 */
export class GitHubAdapterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubAdapterError';
  }
}

/**
 * Commit paths must be plain repo-relative paths, each written once: no
 * absolute paths, `.`/`..` segments, empty segments or backslashes.
 */
export function assertCommitPaths(files: readonly CommitFile[]): void {
  const seen = new Set<string>();
  for (const f of files) {
    const p = f.path;
    const segments = p.split('/');
    if (!p || p.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
      throw new GitHubAdapterError(`Unsafe commit path: ${JSON.stringify(p)}`, 422);
    }
    if (seen.has(p)) throw new GitHubAdapterError(`Duplicate commit path: ${p}`, 422);
    seen.add(p);
  }
}
