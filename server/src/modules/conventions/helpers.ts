import { createHash } from 'node:crypto';
import {
  findExecutableContent,
  type ConventionCandidate,
  type ConventionCategory,
  type ConventionScan,
  type ConventionSkillDraft,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import { MAX_CANDIDATES, MAX_SNIPPET_CHARS, REDACTED_MARK, SKILL_NAME, SNIPPET_CONTEXT_LINES } from './constants.js';
import type { ConventionExtraction } from './prompt.js';
import type { SampleFile } from './samples.js';

/**
 * Pure helpers for the conventions module: fingerprinting, grounding the
 * model's answer against the sampled files, DTO mapping and the skill draft.
 */

/**
 * Same normalization as the 0011 backfill, ASCII-only on purpose so JS and
 * Postgres always agree: trim, collapse whitespace, lowercase A-Z.
 */
export function normalizeRule(rule: string): string {
  return rule
    .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Identity of a rule across scans (category is NOT part of it: a re-categorized rule is the same rule). */
export function fingerprintRule(rule: string): string {
  return createHash('sha256').update(normalizeRule(rule)).digest('hex');
}

/** Stable round-robin over groups (groups in first-appearance order, items keep their order). */
function roundRobin<T>(items: readonly T[], key: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]!);
  }
  return out;
}

/**
 * HW2 #39 — choose `n` sample files from repo-intel's ranked list, spread over
 * the repo's top-level folders (`server/`, `client/`, root files) and, inside
 * each, over parent folders, so one package or one folder cannot fill all the
 * slots. Rank order decides within a folder and which folder comes first.
 * Top-level dot-folders (`.claude/`, `.github/`) hold tooling and reference
 * material, not the house style, and are left out (as for config files).
 */
export function spreadSampleFiles(ranked: readonly string[], n: number): string[] {
  const paths = [...new Set(ranked.map((p) => p.replace(/\\/g, '/')))].filter((p) => !/^\.[^/]*\//.test(p));
  const parent = (p: string) => p.slice(0, p.lastIndexOf('/') + 1);
  const top = (p: string) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');
  return roundRobin(roundRobin(paths, parent), top).slice(0, Math.max(0, n));
}

/** A candidate that passed grounding, ready to store. */
export interface GroundedCandidate {
  rule: string;
  category: ConventionCategory;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  confidence: number;
  fingerprint: string;
}

export interface GroundingResult {
  candidates: GroundedCandidate[];
  dropped: { rule: string; reason: string }[];
}

const UNSAFE_RULE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

/** The stored snippet: the evidence line with a little context, read from the SAMPLED text (already redacted). */
export function snippetAround(lines: readonly string[], line: number): string {
  const from = Math.max(0, line - 1 - SNIPPET_CONTEXT_LINES);
  const to = Math.min(lines.length, line + SNIPPET_CONTEXT_LINES);
  // Blank lines at the edges carry no evidence (e.g. the empty line after a file's last newline).
  let a = from;
  let b = to;
  while (a < b && !lines[a]!.trim()) a++;
  while (b > a && !lines[b - 1]!.trim()) b--;
  const text = lines.slice(a, b).join('\n');
  return text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS)}…` : text;
}

/**
 * Keep only candidates whose evidence is real: the path is one of the files
 * sent, the line exists there and is not blank or redacted. The snippet comes
 * from that file, never from the model. Duplicates (same fingerprint) and
 * unsafe or over-long rules are dropped; confidence is clamped to 0..1.
 */
export function groundCandidates(raw: ConventionExtraction['candidates'], files: readonly SampleFile[]): GroundingResult {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const candidates: GroundedCandidate[] = [];
  const dropped: GroundingResult['dropped'] = [];
  for (const c of raw.slice(0, MAX_CANDIDATES)) {
    const rule = c.rule.trim().replace(/\s+/g, ' ');
    const drop = (reason: string) => dropped.push({ rule: rule.slice(0, 120), reason });
    if (!rule || rule.length > 300) {
      drop('empty or over-long rule');
      continue;
    }
    if (UNSAFE_RULE_CHARS.test(rule) || findExecutableContent(rule)) {
      drop('unsafe rule text');
      continue;
    }
    const file = byPath.get(c.evidence_path.trim().replace(/^\.\//, ''));
    if (!file) {
      drop('evidence file was not sampled');
      continue;
    }
    const line = c.evidence_line;
    if (!Number.isInteger(line) || line < 1 || line > file.lines.length) {
      drop('evidence line is outside the file');
      continue;
    }
    const text = file.lines[line - 1]!;
    if (!text.trim() || text.includes(REDACTED_MARK)) {
      drop('evidence line is blank or redacted');
      continue;
    }
    const fingerprint = fingerprintRule(rule);
    if (seen.has(fingerprint)) {
      drop('duplicate rule');
      continue;
    }
    seen.add(fingerprint);
    candidates.push({
      rule,
      category: c.category,
      evidencePath: file.path,
      evidenceLine: line,
      evidenceSnippet: snippetAround(file.lines, line),
      confidence: Number.isFinite(c.confidence) ? Math.min(1, Math.max(0, c.confidence)) : 0,
      fingerprint,
    });
  }
  return { candidates, dropped };
}

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    rule: row.rule,
    category: row.category,
    evidence_path: row.evidencePath,
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status,
    accepted: row.status === 'accepted',
    scan_id: row.scanId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    sample_files: row.sampleFiles ?? [],
    candidates_found: row.candidatesFound,
    candidates_added: row.candidatesAdded,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    error: row.error,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

const CATEGORY_TITLE: Record<ConventionCategory, string> = {
  naming: 'Naming',
  structure: 'Structure',
  error_handling: 'Error handling',
  types: 'Types',
  testing: 'Testing',
  imports: 'Imports',
  style: 'Style',
  api: 'API',
  other: 'Other',
};

/** Longest backtick run in `text` + 1, so a code fence can never be closed from inside. */
function fenceFor(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return '`'.repeat(longest + 1);
}

/**
 * HW2 #41/#42 — the `repo-conventions` skill draft, from ACCEPTED candidates
 * only: one section per category, each rule with its `file:line` evidence.
 * The user reviews / edits it before it is saved.
 */
export function buildSkillDraft(repoFullName: string, accepted: readonly ConventionRow[]): ConventionSkillDraft {
  const order = Object.keys(CATEGORY_TITLE) as ConventionCategory[];
  const sorted = [...accepted].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const lines = [
    `# ${repoFullName} conventions`,
    '',
    `House rules of \`${repoFullName}\`, extracted from its code and accepted by the team.`,
    'Flag changes that break any rule below and cite the offending `file:line`.',
  ];
  let current: ConventionCategory | null = null;
  for (const c of sorted) {
    if (c.category !== current) {
      current = c.category;
      lines.push('', `## ${CATEGORY_TITLE[current]}`);
    }
    lines.push('', `- ${c.rule}`);
    if (c.evidencePath) {
      // A nested item, so Markdown never runs it into the rule text.
      lines.push(`  - Example: \`${c.evidencePath}${c.evidenceLine ? `:${c.evidenceLine}` : ''}\``);
      if (c.evidenceSnippet) {
        const fence = fenceFor(c.evidenceSnippet);
        // Fences start at column 0: the shared content check exempts code only there.
        lines.push(fence, ...c.evidenceSnippet.split('\n'), fence);
      }
    }
  }
  const files = [...new Set(sorted.flatMap((c) => (c.evidencePath ? [c.evidencePath] : [])))];
  return {
    name: SKILL_NAME,
    description: `${sorted.length} house convention${sorted.length === 1 ? '' : 's'} extracted from ${repoFullName}`,
    type: 'convention',
    body: lines.join('\n') + '\n',
    evidence_files: files.slice(0, 100),
    convention_ids: sorted.map((c) => c.id),
  };
}
