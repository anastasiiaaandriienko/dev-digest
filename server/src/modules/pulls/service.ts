import type { PullLookup } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ValidationError } from '../../platform/errors.js';
import { PullsRepository } from './repository.js';

/** Most PRs one lookup returns; more matches set `truncated`. */
export const PULL_LOOKUP_LIMIT = 20;

export interface PullLookupQuery {
  number?: number;
  title?: string;
  repo?: string;
}

/**
 * Read-only PR lookup over STORED pull requests (no GitHub sync, no writes).
 * Returns every match so the caller decides: one match → use it; several →
 * ask which one. It never picks the first match on the caller's behalf.
 */
export class PullsService {
  private repo: PullsRepository;

  constructor(container: Container) {
    this.repo = new PullsRepository(container.db);
  }

  async lookup(workspaceId: string, query: PullLookupQuery): Promise<PullLookup> {
    if (query.number === undefined && query.title === undefined) {
      throw new ValidationError('Provide number or title');
    }

    let repoIds: string[] | undefined;
    let repoMatches: PullLookup['repo_matches'] = null;
    if (query.repo !== undefined) {
      const repos = await this.repo.findRepos(workspaceId, query.repo);
      repoMatches = repos.map((r) => ({ id: r.id, full_name: r.fullName }));
      if (repos.length === 0) return { matches: [], truncated: false, repo_matches: repoMatches };
      repoIds = repos.map((r) => r.id);
    }

    const rows = await this.repo.findPulls(
      workspaceId,
      { number: query.number, title: query.title, repoIds },
      PULL_LOOKUP_LIMIT + 1,
    );
    return {
      matches: rows.slice(0, PULL_LOOKUP_LIMIT).map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        repo_id: r.repoId,
        repo_full_name: r.repoFullName,
      })),
      truncated: rows.length > PULL_LOOKUP_LIMIT,
      repo_matches: repoMatches,
    };
  }
}
