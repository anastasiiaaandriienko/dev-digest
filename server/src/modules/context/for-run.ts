import { renderSpecsBlock, wrapUntrusted, type PromptSpecGroup } from '@devdigest/reviewer-core';
import { groupContextDocs, type PromptAssembly, type SpecBlock, type SpecSummary } from '@devdigest/shared';
import {
  MAX_ATTACHMENTS,
  MAX_DOC_BYTES,
  MAX_DOC_TOKENS,
  MAX_PROMPT_TOKENS,
  SKIP_REASONS,
  TRUNCATION_MARKER,
  USER_OMITTED_PLACEHOLDER,
  placeholderLine,
} from './constants.js';
import { effectiveRoots, isUnderRoots, normalizeContextPath } from './helpers.js';
import { readContextDoc } from './read.js';
import type { ContextAttachmentRow, ProjectContextInput } from './types.js';

/** Heading of the section reviewer-core renders around the specs block. */
const SECTION_HEAD = '## Project context\n';

/** Skip reason for an entry whose header + marker alone exceed L5 (practically unreachable). */
const ENTRY_TOO_LARGE = 'entry exceeds the token limit';

export interface ProjectContextDeps {
  /** Real path of the clone worktree, or null while the repo is not cloned. */
  cloneRoot: string | null;
  /** Token counter (the container tokenizer). */
  count: (text: string) => number;
  readDoc?: typeof readContextDoc;
}

/** One doc that went into the prompt: its full entry (never persisted) and metadata. */
export interface ReadEntry {
  path: string;
  /** `path: <p>\n\n<redacted, capped content>` — goes to reviewer-core as one `specs[]` item. */
  text: string;
  tokens: number;
  truncated: boolean;
}

export interface BuiltProjectContext {
  /** Entry texts in prompt order (grouped, see `groups`). */
  specs: string[];
  /** Injected paths in prompt order (trace `specs_read`). */
  specsRead: string[];
  /** Read entries in prompt order. */
  reads: ReadEntry[];
  /**
   * `specGroups` for reviewer-core: the read entries under their prompt headings
   * (Project specifications, docs, insights, other — `CONTEXT_DOC_GROUPS`),
   * stable inside a group. Selection and the L6 budget still follow injection order.
   */
  groups: PromptSpecGroup[];
  /** One block per attachment occurrence (metadata only). */
  blocks: SpecBlock[];
  summary: SpecSummary;
}

/**
 * Cut an entry to L5: drop whole trailing lines and append the marker so that
 * entry + marker is at most `MAX_DOC_TOKENS`. Null when even zero lines do not fit.
 */
function fitEntry(
  path: string,
  text: string,
  count: (t: string) => number,
): { text: string; tokens: number; cut: boolean } | null {
  const head = `path: ${path}\n\n`;
  const full = head + text;
  const tokens = count(full);
  if (tokens <= MAX_DOC_TOKENS) return { text: full, tokens, cut: false };

  const lines = text.split('\n');
  const build = (k: number) => `${head}${lines.slice(0, k).join('\n')}${k > 0 ? '\n' : ''}${TRUNCATION_MARKER}`;
  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (count(build(mid)) <= MAX_DOC_TOKENS) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const cutText = build(best);
  return { text: cutText, tokens: count(cutText), cut: true };
}

/**
 * Turn the stored attachments of a run into the Project Context input
 * (spec §8): the agent's rows by `order`, then each applied skill's rows in the
 * given order; L7 first 10 rows per owner, repeats are `duplicate`, then path
 * checks → outside roots → read once; L5 per entry, L6 running sum (the first
 * entry that does not fit and every later one are skipped, no skip-and-continue).
 * Never throws for a bad doc: it is recorded in `blocks`.
 */
export async function buildProjectContext(
  input: ProjectContextInput,
  deps: ProjectContextDeps,
): Promise<BuiltProjectContext> {
  const readDoc = deps.readDoc ?? readContextDoc;
  const roots = effectiveRoots(input.roots);
  const owners: { source: 'agent' | 'skill'; skillId: string | null; rows: ContextAttachmentRow[] }[] = [
    { source: 'agent', skillId: null, rows: input.agent },
    ...input.skills.map((s) => ({ source: 'skill' as const, skillId: s.skillId, rows: s.rows })),
  ];

  const blocks: SpecBlock[] = [];
  const reads: ReadEntry[] = [];
  const seen = new Set<string>();
  let used = 0;
  let exhausted = false;

  for (const owner of owners) {
    const rows = [...owner.rows].sort((a, b) => a.order - b.order);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const base = {
        path: row.path,
        source: owner.source,
        ...(owner.skillId ? { skill_id: owner.skillId } : {}),
      };
      const skip = (reason: string): void => {
        blocks.push({ ...base, status: 'skipped', reason });
      };

      if (!deps.cloneRoot) {
        skip(SKIP_REASONS.repoNotCloned);
        continue;
      }
      if (i >= MAX_ATTACHMENTS) {
        skip(SKIP_REASONS.attachmentLimit);
        continue;
      }
      const n = normalizeContextPath(row.path);
      if (!n.ok) {
        skip(n.reason);
        continue;
      }
      if (seen.has(n.path)) {
        skip(SKIP_REASONS.duplicate);
        continue;
      }
      seen.add(n.path);
      if (!isUnderRoots(n.path, roots)) {
        skip(SKIP_REASONS.outsideRoots);
        continue;
      }
      if (exhausted) {
        skip(SKIP_REASONS.budgetExhausted);
        continue;
      }

      const doc = await readDoc(deps.cloneRoot, n.path, MAX_DOC_BYTES);
      if (doc.kind === 'missing') {
        blocks.push({ ...base, path: n.path, status: 'missing' });
        continue;
      }
      if (doc.kind === 'skip') {
        blocks.push({ ...base, path: n.path, status: 'skipped', reason: doc.reason });
        continue;
      }
      const fit = fitEntry(n.path, doc.text, deps.count);
      if (!fit) {
        blocks.push({ ...base, path: n.path, status: 'skipped', reason: ENTRY_TOO_LARGE });
        continue;
      }
      if (used + fit.tokens > MAX_PROMPT_TOKENS) {
        exhausted = true;
        blocks.push({ ...base, path: n.path, status: 'skipped', reason: SKIP_REASONS.budgetExhausted });
        continue;
      }
      used += fit.tokens;
      const truncated = doc.truncated || fit.cut;
      reads.push({ path: n.path, text: fit.text, tokens: fit.tokens, truncated });
      blocks.push({ ...base, path: n.path, status: 'read', tokens: fit.tokens, truncated });
    }
  }

  const count = (status: SpecBlock['status']) => blocks.filter((b) => b.status === status).length;
  const summary: SpecSummary = {
    attached: blocks.length,
    read: reads.length,
    missing: count('missing'),
    skipped: count('skipped'),
    truncated: reads.filter((r) => r.truncated).length,
    tokens: used,
    limits: {
      doc_bytes: MAX_DOC_BYTES,
      doc_tokens: MAX_DOC_TOKENS,
      prompt_tokens: MAX_PROMPT_TOKENS,
      attachments: MAX_ATTACHMENTS,
    },
  };
  const grouped = groupContextDocs(reads, (r) => r.path, roots);
  const ordered = grouped.flatMap((g) => g.items);
  return {
    specs: ordered.map((r) => r.text),
    specsRead: ordered.map((r) => r.path),
    reads: ordered,
    groups: grouped.map((g) => ({ title: g.title, specs: g.items.map((r) => r.text) })),
    blocks,
    summary,
  };
}

/** The run-log line of the context step. Never contains doc text. */
export function contextLogLine(summary: SpecSummary): string {
  return `context: attached ${summary.read} doc(s) (${summary.tokens} tokens), skipped ${summary.skipped}, truncated ${summary.truncated}`;
}

export const CONTEXT_UNAVAILABLE_LINE = 'context: unavailable';

/** Warning for a trace whose Project Context section could not be isolated (AC-CTX-73). */
export const CONTEXT_NOT_ISOLATED_LINE =
  'context: warning — project context could not be isolated in the prompt; user prompt omitted from the trace';

export interface RedactedAssembly {
  assembly: PromptAssembly;
  /** False when the section could not be isolated and `user` was replaced (fail closed). */
  isolated: boolean;
}

/** The text of `block` as it appears inside its own `wrapUntrusted` wrapper. */
function wrappedForm(entry: string): string {
  const w = wrapUntrusted('x', entry);
  const open = '<untrusted source="x">\n';
  const close = '\n</untrusted>';
  return w.slice(open.length, w.length - close.length);
}

/**
 * Build the `prompt_assembly` to persist (spec §6, Q16): doc text is replaced by
 * deterministic placeholders in `specs` and in the Project Context section of
 * `user`; everything else stays byte-identical. Fails closed: if the real section
 * cannot be located, or any entry text is still present afterwards, `user` is
 * replaced by a fixed placeholder. With no doc read, specs/user are untouched.
 */
export function redactAssemblyForTrace(
  assembly: PromptAssembly,
  ctx: BuiltProjectContext,
  count: (text: string) => number,
): RedactedAssembly {
  const meta = {
    spec_blocks: ctx.blocks,
    specs_tokens: assembly.specs ? count(`${SECTION_HEAD}${assembly.specs}`) : null,
    spec_summary: ctx.summary,
  };
  if (ctx.reads.length === 0) return { assembly: { ...assembly, ...meta }, isolated: true };

  // Same layout as the real block (headings + spec-<i> wrappers), placeholder lines instead of text.
  const lines = ctx.reads.map((r) => placeholderLine(r.path, r.tokens, r.truncated));
  let next = 0;
  const placeholderGroups = (ctx.groups ?? []).map((g) => ({ title: g.title, specs: g.specs.map(() => lines[next++]!) }));
  const placeholders = renderSpecsBlock(lines, placeholderGroups) ?? '';

  let user = USER_OMITTED_PLACEHOLDER;
  let isolated = false;
  const realSpecs = assembly.specs;
  const idx = realSpecs ? assembly.user.indexOf(`${SECTION_HEAD}${realSpecs}`) : -1;
  if (realSpecs && idx >= 0) {
    const end = idx + SECTION_HEAD.length + realSpecs.length;
    user = `${assembly.user.slice(0, idx)}${SECTION_HEAD}${placeholders}${assembly.user.slice(end)}`;
    const residual = ctx.reads.some(
      (r) =>
        user.includes(r.text) ||
        placeholders.includes(r.text) ||
        user.includes(wrappedForm(r.text)) ||
        placeholders.includes(wrappedForm(r.text)),
    );
    isolated = !residual;
    if (residual) user = USER_OMITTED_PLACEHOLDER;
  }
  return { assembly: { ...assembly, specs: placeholders, user, ...meta }, isolated };
}
