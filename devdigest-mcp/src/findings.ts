import { z } from 'zod';
import type { ApiFinding, ApiReview } from './api-schemas.js';
import { clip } from './tool-result.js';

/**
 * Compact, model-friendly view of persisted reviews and findings, shared by
 * get_findings and run_agent_on_pr. Presentation only: severity, grounding and
 * scores are whatever the server stored.
 */

export const MAX_FINDINGS_PER_REVIEW = 50;
const TEXT_MAX = 500;
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2, INFO: 3 };

export const FindingOut = z.object({
  id: z.string(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  rationale: z.string().nullable(),
  suggestion: z.string().nullable(),
  confidence: z.number().nullable(),
  state: z.enum(['open', 'accepted', 'dismissed']),
});
export type FindingOut = z.infer<typeof FindingOut>;

export const ReviewOut = z.object({
  review_id: z.string(),
  run_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().nullable(),
  summary: z.string().nullable(),
  model: z.string().nullable(),
  created_at: z.string(),
  severity_counts: z.record(z.number()),
  findings_total: z.number(),
  findings_truncated: z.boolean(),
  findings: z.array(FindingOut),
});
export type ReviewOut = z.infer<typeof ReviewOut>;

function toFinding(f: ApiFinding): FindingOut {
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    file: f.file,
    start_line: f.start_line,
    end_line: f.end_line,
    rationale: clip(f.rationale, TEXT_MAX),
    suggestion: clip(f.suggestion, TEXT_MAX),
    confidence: f.confidence ?? null,
    state: f.dismissed_at ? 'dismissed' : f.accepted_at ? 'accepted' : 'open',
  };
}

const bySeverityThenLocation = (a: ApiFinding, b: ApiFinding) =>
  (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
  (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
  a.start_line - b.start_line;

export function toReviewOut(r: ApiReview): ReviewOut {
  const sorted = [...r.findings].sort(bySeverityThenLocation);
  const severity_counts: Record<string, number> = {};
  for (const f of r.findings) severity_counts[f.severity] = (severity_counts[f.severity] ?? 0) + 1;
  return {
    review_id: r.id,
    run_id: r.run_id ?? null,
    agent_id: r.agent_id ?? null,
    agent_name: r.agent_name ?? null,
    verdict: r.verdict ?? null,
    score: r.score ?? null,
    summary: clip(r.summary, 1_000),
    model: r.model ?? null,
    created_at: r.created_at,
    severity_counts,
    findings_total: r.findings.length,
    findings_truncated: r.findings.length > MAX_FINDINGS_PER_REVIEW,
    findings: sorted.slice(0, MAX_FINDINGS_PER_REVIEW).map(toFinding),
  };
}

/** Short text block for one review. */
export function reviewText(r: ReviewOut): string {
  const counts = Object.entries(r.severity_counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  const head = `${r.agent_name ?? 'agent'}: verdict ${r.verdict ?? 'n/a'}, score ${r.score ?? 'n/a'}, ${r.findings_total} finding(s)${counts ? ` (${counts})` : ''}`;
  const lines = r.findings.map((f) => `- [${f.severity}] ${f.file}:${f.start_line} — ${f.title}${f.state !== 'open' ? ` (${f.state})` : ''}`);
  if (r.findings_truncated) lines.push(`- … ${r.findings_total - r.findings.length} more not shown`);
  return [head, ...lines].join('\n');
}
