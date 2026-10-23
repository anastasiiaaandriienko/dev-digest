import { z } from 'zod';
import type { RunRequest } from '@devdigest/shared';
import { AppError } from '../../../platform/errors.js';
import { MAX_AGENTS_PER_RUN } from './constants.js';

/**
 * The agent list of a multi-agent request, or null for a legacy
 * `{agentId}` / `{all}` body (handled by `resolveTargets` exactly as before).
 * Duplicates are dropped keeping the first occurrence, so list order = column
 * order. Empty, more than MAX_AGENTS_PER_RUN distinct ids, or `agentIds`
 * combined with `agentId`/`all` → 400 `invalid_run_request` (AC-MAR-03).
 */
export function normalizeAgentIds(body: RunRequest): string[] | null {
  if (body.agentIds === undefined) return null;
  if (body.agentId !== undefined || body.all !== undefined) {
    throw new AppError('invalid_run_request', 'Provide only one of agentId, all or agentIds', 400);
  }
  const ids = [...new Set(body.agentIds)];
  if (ids.length === 0) {
    throw new AppError('invalid_run_request', 'agentIds must list at least one agent', 400);
  }
  if (ids.length > MAX_AGENTS_PER_RUN) {
    throw new AppError(
      'invalid_run_request',
      `agentIds may list at most ${MAX_AGENTS_PER_RUN} distinct agents`,
      400,
    );
  }
  return ids;
}

const AgentIdShape = z.string().uuid();

/**
 * Agent ids are uuids. A malformed one cannot name an agent, so it is a 404
 * like any unknown agent — answered without a query, so Postgres never sees
 * an invalid uuid (which it would reject with a 500).
 */
export function isAgentId(id: string): boolean {
  return AgentIdShape.safeParse(id).success;
}
