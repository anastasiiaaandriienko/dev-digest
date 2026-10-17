/** Constants for the blast module. */

/** Base of the GitHub blob links built for callers and changed symbols. */
export const GITHUB_HOST = 'https://github.com';

/** Plain-language note per degraded reason, appended to the summary. */
export const DEGRADED_NOTES = {
  flag_off: 'Repo intelligence is turned off (REPO_INTEL_ENABLED=false).',
  no_data: 'The repository is not indexed yet; callers come from a name-based scan of the clone and may be incomplete.',
  index_partial: 'The repository index is partial; some callers or endpoints may be missing.',
  index_failed: 'The last index run failed; callers come from a name-based scan of the clone and may be incomplete.',
  repo_too_large: 'The repository is too large to index fully; results may be incomplete.',
  no_files: 'The changed files of this PR are not stored yet; open the PR once to sync them.',
} as const;
