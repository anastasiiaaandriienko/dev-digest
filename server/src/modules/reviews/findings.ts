import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss. These decisions
 * are the dataset later lessons build on (eval cases from accept/dismiss, the
 * `learn → memory` action, etc.).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  // The decision never changes an existing eval case (cases are snapshots); the
  // DTO just reports it so the client keeps its "In eval set" state.
  const evalCaseId = async () => (await repo.evalCaseIdsForFindings(workspaceId, [findingId])).get(findingId) ?? null;
  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!, await evalCaseId()) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!, await evalCaseId()) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}
