import {
  SMART_GROUP_ORDER,
  classifySmartFile,
  type ProposedSplit,
  type SmartDiff,
  type SmartDiffFile,
  type SmartGroupKey,
} from '@devdigest/shared';
import { SMART_DIFF_SPLIT_DIR_DEPTH, SMART_DIFF_SPLIT_THRESHOLD_LINES } from './constants.js';

/**
 * GET /pulls/:id/smart-diff — pure builder (no DB, no I/O). Groups the PR's
 * stored files with the shared classification rules (`@devdigest/shared`
 * smart-diff-rules, the same module the client's "Smart order" uses), anchors
 * findings to changed lines and proposes a split for large PRs.
 *
 * Deterministic: groups in SMART_GROUP_ORDER, files by path (code-unit order),
 * finding_lines ascending and unique, splits in group order.
 */

export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
  /** Raw unified-diff patch (`pr_files.patch`); null for binary/oversized files. */
  patch: string | null;
}

export interface SmartDiffFindingInput {
  file: string;
  start_line: number;
  end_line: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * New-side line numbers a patch renders (added + context lines), like the
 * diff viewer. Deletions and `\ No newline at end of file` consume no line.
 */
export function newSideLines(patch: string | null | undefined): Set<number> {
  const out = new Set<number>();
  if (!patch) return out;
  let cursor: number | null = null;
  for (const line of patch.replace(/\r\n?/g, '\n').split('\n')) {
    const hh = HUNK_HEADER.exec(line);
    if (hh) {
      cursor = Number(hh[1]);
      continue;
    }
    if (cursor === null || line.startsWith('-') || line.startsWith('\\')) continue;
    // An empty string is the split artefact of a trailing newline, not a context line (that is " ").
    if (line.startsWith('+') || line.startsWith(' ')) {
      out.add(cursor);
      cursor += 1;
    }
  }
  return out;
}

/**
 * The line a finding anchors to — `end_line` when rendered, else the largest
 * rendered line in [start_line, end_line] — or null (unanchored: no line on the
 * changed side, a non-positive or non-integer line, or a file without a patch).
 * Mirrors the client's anchorFindings; work is bounded by the rendered lines,
 * never by the (untrusted) claimed range.
 */
export function anchorLine(lines: ReadonlySet<number>, f: SmartDiffFindingInput): number | null {
  const { start_line: start, end_line: end } = f;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (end > 0 && lines.has(end)) return end;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let best: number | null = null;
  for (const n of lines) if (n >= lo && n <= hi && (best === null || n > best)) best = n;
  return best;
}

function proposeSplits(groups: Map<SmartGroupKey, SmartDiffFile[]>): ProposedSplit[] {
  // Boilerplate (lockfiles, generated output) travels with whichever split needs it; never its own PR.
  const byGroup = SMART_GROUP_ORDER.filter((k) => k !== 'boilerplate')
    .map((k) => ({ name: k, files: (groups.get(k) ?? []).map((f) => f.path) }))
    .filter((s) => s.files.length > 0);
  if (byGroup.length >= 2) return byGroup;

  // One role only: split by leading directories instead.
  const byDir = new Map<string, string[]>();
  for (const s of byGroup) {
    for (const path of s.files) {
      const segs = path.replace(/\\/g, '/').split('/').filter(Boolean);
      const dir = segs.length > 1 ? segs.slice(0, Math.min(SMART_DIFF_SPLIT_DIR_DEPTH, segs.length - 1)).join('/') : '.';
      byDir.set(dir, [...(byDir.get(dir) ?? []), path]);
    }
  }
  if (byDir.size < 2) return [];
  return [...byDir.keys()].sort(byPath).map((dir) => ({ name: `${byGroup[0]!.name}: ${dir}`, files: byDir.get(dir)! }));
}

export function buildSmartDiff(
  files: readonly SmartDiffFileInput[],
  findings: readonly SmartDiffFindingInput[],
): SmartDiff {
  const findingsByFile = new Map<string, SmartDiffFindingInput[]>();
  for (const f of findings) findingsByFile.set(f.file, [...(findingsByFile.get(f.file) ?? []), f]);

  // pr_files has no ordering guarantee and could repeat a path: one entry per path, sorted.
  const unique = new Map<string, SmartDiffFileInput>();
  for (const f of files) if (!unique.has(f.path)) unique.set(f.path, f);
  const sorted = [...unique.values()].sort((a, b) => byPath(a.path, b.path));

  const groups = new Map<SmartGroupKey, SmartDiffFile[]>(SMART_GROUP_ORDER.map((k) => [k, []]));
  let reviewableLines = 0;
  for (const file of sorted) {
    const own = findingsByFile.get(file.path) ?? [];
    const lines = newSideLines(file.patch);
    const anchors = new Set<number>();
    let unanchored = 0;
    for (const f of own) {
      const at = anchorLine(lines, f);
      if (at === null) unanchored += 1;
      else anchors.add(at);
    }
    const role = classifySmartFile(file.path);
    if (role !== 'boilerplate') reviewableLines += file.additions + file.deletions;
    groups.get(role)!.push({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions,
      deletions: file.deletions,
      finding_lines: [...anchors].sort((a, b) => a - b),
      findings_count: own.length,
      unanchored_findings: unanchored,
    });
  }

  const tooBig = reviewableLines > SMART_DIFF_SPLIT_THRESHOLD_LINES;
  return {
    groups: SMART_GROUP_ORDER.map((role) => ({ role, files: groups.get(role)! })),
    split_suggestion: {
      too_big: tooBig,
      total_lines: reviewableLines,
      proposed_splits: tooBig ? proposeSplits(groups) : [],
    },
    findings_outside_diff: findings.filter((f) => !unique.has(f.file)).length,
  };
}
