import { createHash } from 'node:crypto';
import { IntentContextSource, type IntentContextKind, type IntentContextNote } from '@devdigest/shared';
import type { IntentContextSourceRecord } from '../../../db/schema.js';
import {
  INTENT_CONTEXT_LINK_MAX_CHARS,
  INTENT_MAX_ISSUES,
  INTENT_MAX_LINKS,
  INTENT_MAX_PLAN_DOCS,
  INTENT_PLAN_DOC_MAX_CHARS,
} from './constants.js';
import type { IntentFileInput } from './fingerprint.js';

/**
 * L03 intent context beyond the PR title/description: linked issues, ticket /
 * plan links and planning documents. Pure (no I/O): the service fetches issues
 * and passes the results in.
 *
 * Trust rules:
 *  - Only issues of the PR's OWN repository are ever fetched (by number, via the
 *    configured GitHub client). No URL from the PR body is ever requested.
 *  - Other links are reported as `unverified`; their content is unknown.
 *  - URLs are reduced to scheme + host + path (credentials, query and fragment
 *    dropped: they can carry tokens).
 *  - Planning docs are read only from the PR's own stored diff (added lines).
 *  - Everything here is untrusted data for the prompt.
 */

export interface RepoCoords {
  owner: string;
  name: string;
}

export interface ContextLink {
  kind: Extract<IntentContextKind, 'ticket_link' | 'plan_link' | 'link'>;
  url: string;
}

export interface ContextRefs {
  /** Same-repo issue numbers, ascending, the PR's own number excluded, capped at INTENT_MAX_ISSUES. */
  issues: number[];
  /** Same-repo issue numbers beyond the cap (reported, never fetched). */
  issuesOverLimit: number[];
  /** Sanitized links (never fetched), in order of appearance, capped at INTENT_MAX_LINKS. */
  links: ContextLink[];
  /** Repo paths of planning-like docs mentioned in the description. */
  docPaths: string[];
}

export interface PlanDoc {
  path: string;
  /** Added lines of the doc in this PR (clipped); null when the file has no patch. */
  text: string | null;
  truncated: boolean;
}

export type IssueResult =
  | { number: number; status: 'confirmed'; title: string; state: string; body: string }
  | { number: number; status: 'unavailable'; note: Extract<IntentContextNote, 'not_found_or_no_access' | 'github_unavailable' | 'fetch_failed'> };

export interface IntentContext {
  refs: ContextRefs;
  planDocs: PlanDoc[];
  /** Fetch results for `refs.issues`; null when issues were not fetched (GET: local reads only). */
  issues: IssueResult[] | null;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- references in the PR description ---------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]{}"'`]+/gi;
/** `#12`, `owner/repo#12` — not inside a word, a URL fragment or an HTML entity (`&#12;`). */
const ISSUE_RE = /(^|[^\w&/#])(?:([\w.-]+)\/([\w.-]+))?#(\d{1,7})\b/g;
const DOC_PATH_RE = /(?:^|[\s(\["'`])((?:[\w.-]+\/)+[\w.-]+\.(?:md|mdx|rst|txt|adoc))\b/gi;
const PLAN_DOC_PATH = /(^|\/)(plans?|planning|specs?|rfcs?|adrs?|design|decisions|proposals?|roadmap)\//i;
const PLAN_DOC_NAME = /(^|[-_./])(plan|planning|spec|rfc|adr|design|proposal|roadmap)[^/]*\.(md|mdx|rst|txt|adoc)$/i;
const DOC_EXT = /\.(md|mdx|rst|txt|adoc)$/i;

const TICKET_HOSTS = [/(^|\.)atlassian\.net$/, /(^|\.)linear\.app$/, /(^|\.)youtrack\./, /(^|\.)shortcut\.com$/, /(^|\.)clickup\.com$/, /(^|\.)asana\.com$/, /(^|\.)trello\.com$/, /(^|\.)jira\./];
const PLAN_HOSTS = [/(^|\.)notion\.(so|site)$/, /^docs\.google\.com$/, /(^|\.)confluence\./, /(^|\.)figma\.com$/, /(^|\.)miro\.com$/];

/** A repo path that looks like a planning document (by folder or file name). */
export function isPlanDocPath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return DOC_EXT.test(p) && (PLAN_DOC_PATH.test(p) || PLAN_DOC_NAME.test(p));
}

/** scheme://host/path, lower-cased host, no credentials/query/fragment, bounded length; null if not http(s). */
export function sanitizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?]+$/, ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  const clean = `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${path}`;
  return clean.length > INTENT_CONTEXT_LINK_MAX_CHARS ? clean.slice(0, INTENT_CONTEXT_LINK_MAX_CHARS) : clean;
}

function classifyLink(url: string): ContextLink['kind'] {
  const { hostname, pathname } = new URL(url);
  if (hostname === 'github.com' && /^\/[^/]+\/[^/]+\/(issues|pull)\/\d+/.test(pathname)) return 'ticket_link';
  if (TICKET_HOSTS.some((re) => re.test(hostname))) return /\/wiki\//.test(pathname) ? 'plan_link' : 'ticket_link';
  if (PLAN_HOSTS.some((re) => re.test(hostname))) return 'plan_link';
  if (DOC_EXT.test(pathname)) return 'plan_link';
  return 'link';
}

const sameRepo = (owner: string, name: string, repo: RepoCoords) =>
  owner.toLowerCase() === repo.owner.toLowerCase() && name.toLowerCase() === repo.name.toLowerCase();

/**
 * Deterministic references from the PR description. Same-repo issues come from
 * `#N`, `owner/repo#N` and `https://github.com/owner/repo/(issues|pull)/N`;
 * everything else becomes a link that is never fetched.
 */
export function extractContextRefs(body: string | null | undefined, repo: RepoCoords | null, ownNumber: number): ContextRefs {
  const text = (body ?? '').replace(/\r\n?/g, '\n');
  const issues = new Set<number>();
  const links: ContextLink[] = [];
  const seenLinks = new Set<string>();
  const addLink = (kind: ContextLink['kind'], url: string) => {
    if (seenLinks.has(url)) return;
    seenLinks.add(url);
    links.push({ kind, url });
  };

  for (const m of text.matchAll(URL_RE)) {
    const url = sanitizeUrl(m[0]);
    if (!url) continue;
    const gh = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/.exec(url);
    if (gh && repo && sameRepo(gh[1]!, gh[2]!, repo)) {
      issues.add(Number(gh[3]));
      continue;
    }
    addLink(classifyLink(url), url);
  }

  const withoutUrls = text.replace(URL_RE, ' ');
  for (const m of withoutUrls.matchAll(ISSUE_RE)) {
    const [, , owner, name, num] = m;
    const n = Number(num);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    if (owner && name && !(repo && sameRepo(owner, name, repo))) {
      addLink('ticket_link', `https://github.com/${owner}/${name}/issues/${n}`);
      continue;
    }
    issues.add(n); // a bare #N always means this repo (fetched only when the repo is known)
  }
  issues.delete(ownNumber);

  const docPaths = new Set<string>();
  for (const m of withoutUrls.matchAll(DOC_PATH_RE)) {
    const path = m[1]!.replace(/^\.\//, '');
    if (isPlanDocPath(path)) docPaths.add(path);
  }

  const sortedIssues = [...issues].sort((a, b) => a - b);
  return {
    issues: sortedIssues.slice(0, INTENT_MAX_ISSUES),
    issuesOverLimit: sortedIssues.slice(INTENT_MAX_ISSUES),
    links: links.slice(0, INTENT_MAX_LINKS),
    docPaths: [...docPaths].sort(byString),
  };
}

// ---- planning docs in the PR diff ----------------------------------------------

/** Added lines of a raw unified patch (no `+++` header lines), in order. */
export function addedText(patch: string): string {
  return patch
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n')
    .trim();
}

/** Planning docs changed in the PR (by path), sorted, capped; text = their added lines, clipped. */
export function planDocsFromFiles(files: IntentFileInput[] | null): PlanDoc[] {
  if (!files) return [];
  return files
    .filter((f) => isPlanDocPath(f.path))
    .sort((a, b) => byString(a.path, b.path))
    .slice(0, INTENT_MAX_PLAN_DOCS)
    .map((f) => {
      if (!f.patch) return { path: f.path, text: null, truncated: false };
      const text = addedText(f.patch);
      const truncated = text.length > INTENT_PLAN_DOC_MAX_CHARS;
      return { path: f.path, text: truncated ? text.slice(0, INTENT_PLAN_DOC_MAX_CHARS) : text, truncated };
    });
}

export function buildLocalContext(
  body: string | null | undefined,
  repo: RepoCoords | null,
  ownNumber: number,
  files: IntentFileInput[] | null,
): IntentContext {
  return { refs: extractContextRefs(body, repo, ownNumber), planDocs: planDocsFromFiles(files), issues: null };
}

// ---- fingerprints ------------------------------------------------------------------

/**
 * The locally known context that goes into the input fingerprint (refs and the
 * plan-doc text hashes). `null` when there is none, so PRs without any context
 * keep the fingerprint they had before context was added.
 */
export function localContextFingerprint(ctx: IntentContext) {
  const { refs, planDocs } = ctx;
  const empty =
    refs.issues.length === 0 && refs.issuesOverLimit.length === 0 && refs.links.length === 0 && refs.docPaths.length === 0 && planDocs.length === 0;
  if (empty) return null;
  return {
    issues: [...refs.issues, ...refs.issuesOverLimit],
    links: refs.links.map((l) => l.url),
    doc_paths: refs.docPaths,
    plan_docs: planDocs.map((d) => ({ path: d.path, sha: d.text === null ? null : sha256(d.text) })),
  };
}

export function issueContentHash(issue: Extract<IssueResult, { status: 'confirmed' }>): string {
  return sha256(JSON.stringify([issue.title, issue.state, issue.body]));
}

/** Stable key of the fetched issue results (status + content hash per issue); '' when there are none. */
export function issuesKey(issues: IssueResult[] | null): string {
  if (!issues || issues.length === 0) return '';
  return sha256(
    JSON.stringify(issues.map((i) => (i.status === 'confirmed' ? [i.number, 'c', issueContentHash(i)] : [i.number, 'u', i.note]))),
  );
}

/**
 * The same key computed from a stored row's context sources (so a POST can compare
 * fresh fetches with them). A row without a record counts as "no issues": such
 * rows predate context and are already stale through their prompt version.
 */
export function storedIssuesKey(sources: IntentContextSourceRecord[] | null | undefined): string {
  if (!sources) return '';
  const issues = sources.filter((s) => s.kind === 'linked_issue' && s.note !== 'over_limit');
  if (issues.length === 0) return '';
  return sha256(
    JSON.stringify(
      issues.map((s) => {
        const n = Number(s.ref.replace(/^#/, ''));
        return s.status === 'confirmed' ? [n, 'c', s.content_hash ?? null] : [n, 'u', s.note ?? null];
      }),
    ),
  );
}

// ---- sources (stored + shown) ------------------------------------------------------

/**
 * One record per source, in a fixed order: title, description, issues, links,
 * planning docs. Confirmed issues keep a content hash (internal) but never
 * their body.
 */
export function contextSources(
  title: string,
  body: string | null | undefined,
  ctx: IntentContext,
): IntentContextSourceRecord[] {
  const out: IntentContextSourceRecord[] = [];
  out.push(title.trim() ? { kind: 'pr_title', status: 'confirmed', ref: 'title' } : { kind: 'pr_title', status: 'missing', ref: 'title', note: 'empty' });
  out.push(
    (body ?? '').trim()
      ? { kind: 'pr_description', status: 'confirmed', ref: 'description' }
      : { kind: 'pr_description', status: 'missing', ref: 'description', note: 'empty' },
  );

  const fetched = new Map((ctx.issues ?? []).map((i) => [i.number, i]));
  for (const n of ctx.refs.issues) {
    const r = fetched.get(n);
    if (!r) out.push({ kind: 'linked_issue', status: 'unverified', ref: `#${n}`, note: 'not_fetched' });
    else if (r.status === 'confirmed')
      out.push({ kind: 'linked_issue', status: 'confirmed', ref: `#${n}`, title: r.title, content_hash: issueContentHash(r) });
    else out.push({ kind: 'linked_issue', status: 'unavailable', ref: `#${n}`, note: r.note });
  }
  for (const n of ctx.refs.issuesOverLimit) out.push({ kind: 'linked_issue', status: 'unverified', ref: `#${n}`, note: 'over_limit' });
  for (const l of ctx.refs.links) out.push({ kind: l.kind, status: 'unverified', ref: l.url, note: 'not_fetched' });

  const inDiff = new Set(ctx.planDocs.map((d) => d.path));
  for (const d of ctx.planDocs) {
    if (d.text === null) out.push({ kind: 'plan_doc', status: 'unavailable', ref: d.path, note: 'no_patch' });
    else out.push({ kind: 'plan_doc', status: 'confirmed', ref: d.path, ...(d.truncated ? { note: 'truncated' } : {}) });
  }
  for (const p of ctx.refs.docPaths) {
    if (!inDiff.has(p)) out.push({ kind: 'plan_doc', status: 'unverified', ref: p, note: 'not_in_diff' });
  }
  return out;
}

/** Contract view of stored records: drops the internal content hash and any record that no longer parses. */
export function toContextSources(records: IntentContextSourceRecord[] | null | undefined): IntentContextSource[] | null {
  if (!records) return null;
  return records.flatMap((r) => {
    const parsed = IntentContextSource.safeParse({ kind: r.kind, status: r.status, ref: r.ref, title: r.title, note: r.note });
    return parsed.success ? [parsed.data] : [];
  });
}
