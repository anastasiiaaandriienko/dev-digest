import { z } from 'zod';
import { ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const GET_BLAST_RADIUS = 'get_blast_radius';

export const BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE =
  'Blast radius is not available yet: it will be added in HW-04 and will return the impact map of the PR ' +
  '(changed symbols, their callers and affected endpoints) from the existing repo-intel index.';

export const getBlastRadiusInput = {
  pr_id: z.string().uuid().describe('Internal DevDigest pull-request id (uuid).'),
};
export const getBlastRadiusOutput = {
  pr_id: z.string(),
  status: z.literal('not_implemented'),
  message: z.string(),
  blast_radius: z.null(),
};

export const getBlastRadiusConfig = {
  title: 'Get PR blast radius (not implemented yet)',
  description:
    'Placeholder: returns status "not_implemented". In HW-04 it will return the PR impact map (changed symbols, callers, endpoints) from repo-intel. ' +
    'Read-only; makes no API call today.',
  inputSchema: getBlastRadiusInput,
  outputSchema: getBlastRadiusOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

/** Honest stub: no data is invented and no request is made. */
export async function getBlastRadius(_deps: ToolDeps, input: { pr_id: string }): Promise<ToolResult> {
  return ok(BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE, {
    pr_id: input.pr_id,
    status: 'not_implemented',
    message: BLAST_RADIUS_NOT_IMPLEMENTED_MESSAGE,
    blast_radius: null,
  });
}
