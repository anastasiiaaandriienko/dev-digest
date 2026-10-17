import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { changedLinesByFile, emptyBlastRadius, toBlastRadius } from './helpers.js';
import { BlastRepository } from './repository.js';

/**
 * HW-04 Blast Radius: what a PR's changed symbols reach (callers, endpoints,
 * crons) from the existing repo-intel index. Read-only: changed files come
 * from the stored `pr_files`, never from a GitHub sync, and no LLM is involved.
 */
export class BlastService {
  private repo: BlastRepository;

  constructor(private container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async forPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.listChangedFiles(pull.prId);
    if (files.length === 0) return emptyBlastRadius(pull.repoFullName, 'no_files');

    const result = await this.container.repoIntel.getBlastRadius(
      pull.repoId,
      [...new Set(files.map((f) => f.path))],
      changedLinesByFile(files),
    );
    return toBlastRadius(result, pull.repoFullName);
  }
}
