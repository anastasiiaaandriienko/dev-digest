import { z } from 'zod';
import { clip, fail, ok, type ToolResult } from '../tool-result.js';
import type { ToolDeps } from './deps.js';

export const GET_CONVENTIONS = 'get_conventions';

const MAX_CONVENTIONS = 100;

const ConventionOut = z.object({
  id: z.string(),
  rule: z.string(),
  category: z.string(),
  status: z.string(),
  confidence: z.number().nullable(),
  evidence_path: z.string().nullable(),
  evidence_line: z.number().nullable(),
});

export const getConventionsInput = {
  repo_id: z.string().uuid().describe('Internal DevDigest repository id (uuid), as in the web app URL /repos/<repo_id>/….'),
  status: z
    .enum(['accepted', 'pending', 'rejected', 'all'])
    .default('accepted')
    .describe('Which rules to return; "accepted" are the confirmed repo conventions (default).'),
};
export const getConventionsOutput = {
  repo_id: z.string(),
  repo_full_name: z.string(),
  ref: z.string(),
  counts: z.object({ pending: z.number(), accepted: z.number(), rejected: z.number() }),
  last_scan: z.object({ status: z.string(), model: z.string().nullable(), finished_at: z.string().nullable() }).nullable(),
  truncated: z.boolean(),
  conventions: z.array(ConventionOut),
};

export const getConventionsConfig = {
  title: 'Get repository conventions',
  description:
    'Returns the coding conventions extracted for a repository (GET /repos/:id/conventions), by default only the accepted rules. ' +
    'Read-only: never starts a new (paid) extraction scan.',
  inputSchema: getConventionsInput,
  outputSchema: getConventionsOutput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

export async function getConventions(
  deps: ToolDeps,
  input: { repo_id: string; status?: 'accepted' | 'pending' | 'rejected' | 'all' },
): Promise<ToolResult> {
  const status = input.status ?? 'accepted';
  try {
    const includeRejected = status === 'rejected' || status === 'all';
    const state = await deps.api.getConventions(input.repo_id, includeRejected);
    const matching = state.candidates.filter((c) => status === 'all' || c.status === status);
    const conventions = matching.slice(0, MAX_CONVENTIONS).map((c) => ({
      id: c.id,
      rule: clip(c.rule, 500) ?? '',
      category: c.category,
      status: c.status,
      confidence: c.confidence ?? null,
      evidence_path: c.evidence_path ?? null,
      evidence_line: c.evidence_line ?? null,
    }));
    const structured = {
      repo_id: input.repo_id,
      repo_full_name: state.source.repo_full_name,
      ref: state.source.ref,
      counts: state.counts,
      last_scan: state.scan
        ? { status: state.scan.status, model: state.scan.model ?? null, finished_at: state.scan.finished_at ?? null }
        : null,
      truncated: matching.length > MAX_CONVENTIONS,
      conventions,
    };
    const head = `${state.source.repo_full_name}: ${conventions.length} ${status} convention(s) (accepted ${state.counts.accepted}, pending ${state.counts.pending}, rejected ${state.counts.rejected})`;
    const lines = conventions.map((c) => `- [${c.category}] ${c.rule}${c.evidence_path ? ` (${c.evidence_path}${c.evidence_line ? `:${c.evidence_line}` : ''})` : ''}`);
    if (!state.scan) lines.push('No conventions scan has been run for this repository yet.');
    return ok([head, ...lines].join('\n'), structured);
  } catch (err) {
    return fail(err);
  }
}
