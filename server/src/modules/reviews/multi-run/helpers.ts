import { z } from 'zod';
import type {
  AgentColumn,
  AgentColumnFinding,
  Conflict,
  ConflictTake,
  FindingGroup,
  FindingGroupMember,
  MultiAgentRun,
  RunRequest,
} from '@devdigest/shared';
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

// ---------------------------------------------------------------------------
// Read model: latest multi-run → columns, groups, conflicts, totals (FR-3/4).
// Pure functions over already-loaded rows; nothing here writes.
// ---------------------------------------------------------------------------

/** One linked child run as loaded for the read (agent/review may be gone). */
export type ChildRunInput = {
  runId: string;
  agentId: string | null;
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  score: number | null;
  durationMs: number | null;
  ranAt: Date | null;
  costUsd: number | null;
  review: { verdict: string | null; summary: string | null; score: number | null } | null;
  findings: AgentColumnFinding[];
};

/** Label for a column whose agent was deleted after the run (`agent_id` set null). */
export const UNKNOWN_AGENT_NAME = 'Unknown agent';

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
const rankOf = (severity: string) => SEVERITY_RANK[severity] ?? 0;

/** agent_runs.status → column status; anything unexpected reads as failed. */
export function toColumnStatus(status: string | null): AgentColumn['status'] {
  return status === 'done' || status === 'running' || status === 'cancelled' ? status : 'failed';
}

/** Columns ordered by child `ran_at` ascending, tie-broken by run id (AC-MAR-53). */
export function orderChildren(children: readonly ChildRunInput[]): ChildRunInput[] {
  return [...children].sort((a, b) => {
    const ta = a.ranAt?.getTime() ?? 0;
    const tb = b.ranAt?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
  });
}

export function toColumn(child: ChildRunInput): AgentColumn {
  return {
    run_id: child.runId,
    agent_id: child.agentId ?? '',
    agent_name: child.agentName ?? UNKNOWN_AGENT_NAME,
    provider: child.provider,
    model: child.model,
    status: toColumnStatus(child.status),
    error: child.error,
    verdict: child.review?.verdict ?? null,
    score: child.score ?? child.review?.score ?? null,
    summary: child.review?.summary ?? null,
    duration_ms: child.durationMs,
    cost_usd: child.costUsd,
    findings: child.findings,
  };
}

type Member = { column: number; finding: AgentColumnFinding };

/** The member with the highest severity; ties keep the earlier one (column order). */
const topOf = (members: readonly Member[]): Member =>
  members.reduce((best, m) => (rankOf(m.finding.severity) > rankOf(best.finding.severity) ? m : best));

/**
 * One take per column (AC-MAR-16, 54): `no_result` unless the run is `done`;
 * else its highest-severity member (note = that finding's title), or
 * `ignored` with an empty note when it did not flag the group.
 */
function takesFor(columns: readonly AgentColumn[], members: readonly Member[]): ConflictTake[] {
  return columns.map((col, column): ConflictTake => {
    const base = { agent_id: col.agent_id, persona: col.agent_name };
    if (col.status !== 'done') return { ...base, verdict: 'no_result', note: '' };
    const own = members.filter((m) => m.column === column);
    if (own.length === 0) return { ...base, verdict: 'ignored', note: '' };
    const top = topOf(own);
    return { ...base, verdict: top.finding.severity, note: top.finding.title };
  });
}

/**
 * Group the columns' findings (AC-MAR-12..14): same `file` and overlapping
 * inclusive `[start_line, end_line]`, transitively (connected components = a
 * sweep over ranges sorted by start). Every finding lands in exactly one
 * group with its run/agent attribution. Groups come out by file, then line.
 */
export function groupFindings(columns: readonly AgentColumn[]): FindingGroup[] {
  const byFile = new Map<string, Member[]>();
  columns.forEach((col, column) => {
    for (const finding of col.findings) {
      const list = byFile.get(finding.file) ?? [];
      list.push({ column, finding });
      byFile.set(finding.file, list);
    }
  });

  const drafts: { file: string; start: number; end: number; members: Member[] }[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const items = byFile
      .get(file)!
      .sort((a, b) => a.finding.start_line - b.finding.start_line || a.column - b.column);
    let current: (typeof drafts)[number] | null = null;
    for (const item of items) {
      const start = item.finding.start_line;
      const end = Math.max(item.finding.end_line, start);
      if (current && start <= current.end) {
        current.end = Math.max(current.end, end);
        current.members.push(item);
      } else {
        current = { file, start, end, members: [item] };
        drafts.push(current);
      }
    }
  }

  return drafts.map((d) => {
    const members = [...d.members].sort((a, b) => a.column - b.column);
    return {
      file: d.file,
      start_line: d.start,
      end_line: d.end,
      // Highest severity, ties by column order (members are in column order).
      title: topOf(members).finding.title,
      members: members.map(({ column, finding }): FindingGroupMember => ({
        finding_id: finding.id,
        run_id: columns[column]!.run_id,
        agent_id: columns[column]!.agent_id,
        agent_name: columns[column]!.agent_name,
        severity: finding.severity,
        title: finding.title,
      })),
      takes: takesFor(columns, members),
    };
  });
}

/**
 * A group is a conflict (AC-MAR-15) when, among `done` columns, one flagged it
 * and another did not, or the flagging columns' highest severities differ.
 */
export function isConflict(group: FindingGroup, columns: readonly AgentColumn[]): boolean {
  const verdicts = group.takes.filter((_, i) => columns[i]!.status === 'done').map((t) => t.verdict);
  const flagged = verdicts.filter((v) => v !== 'ignored');
  if (flagged.length === 0) return false;
  return flagged.length < verdicts.length || new Set(flagged).size > 1;
}

export function toConflict(group: FindingGroup): Conflict {
  return {
    file: group.file,
    line: group.start_line,
    start_line: group.start_line,
    end_line: group.end_line,
    title: group.title,
    takes: group.takes,
  };
}

/** Totals (AC-MAR-17, 18). */
export function totalsOf(
  children: readonly ChildRunInput[],
): Pick<MultiAgentRun, 'total_duration_ms' | 'wall_clock_ms' | 'total_cost_usd' | 'cost_partial'> {
  const known = children.map((c) => c.costUsd).filter((c): c is number => c != null);
  const total_duration_ms = children.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  // Wall clock over terminal children with a known duration (a reaped run has none).
  const spans = children
    .filter((c) => toColumnStatus(c.status) !== 'running' && c.ranAt != null && c.durationMs != null)
    .map((c) => ({ start: c.ranAt!.getTime(), end: c.ranAt!.getTime() + c.durationMs! }));
  return {
    total_duration_ms,
    wall_clock_ms:
      spans.length === 0 ? null : Math.max(...spans.map((s) => s.end)) - Math.min(...spans.map((s) => s.start)),
    total_cost_usd: known.length === 0 ? null : known.reduce((a, b) => a + b, 0),
    cost_partial: children.some((c) => toColumnStatus(c.status) === 'done' && c.costUsd == null),
  };
}

/** Assemble the read model of one multi-run from its loaded child runs. */
export function buildMultiAgentRun(
  parent: { id: string; prId: string; prNumber: number | null; ranAt: Date },
  children: readonly ChildRunInput[],
): MultiAgentRun {
  const ordered = orderChildren(children);
  const columns = ordered.map(toColumn);
  const groups = groupFindings(columns);
  return {
    id: parent.id,
    pr_id: parent.prId,
    pr_number: parent.prNumber,
    ran_at: parent.ranAt.toISOString(),
    agent_count: columns.length,
    ...totalsOf(ordered),
    columns,
    groups,
    conflicts: groups.filter((g) => isConflict(g, columns)).map(toConflict),
  };
}
