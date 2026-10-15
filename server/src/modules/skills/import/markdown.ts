import { SkillType, skillImportIssues, type SkillImportCandidate, type SkillImportIssue } from '@devdigest/shared';
import { FORBIDDEN_MAGIC } from './constants.js';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** What kind of non-Markdown file `bytes` starts like, or null. */
export function forbiddenMagic(bytes: Uint8Array): string | null {
  for (const [what, magic] of FORBIDDEN_MAGIC) {
    if (magic.every((b, i) => bytes[i] === b)) return what;
  }
  return null;
}

/** Strict UTF-8 → string (BOM dropped, CRLF → LF); null when not valid UTF-8. */
export function decodeText(bytes: Uint8Array): string | null {
  try {
    return utf8.decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

/** `My Skill_v2.md` → `my-skill-v2` (a proposal; the user can edit it). */
export function nameFromPath(path: string): string {
  const parts = path.split('/');
  let stem = (parts.at(-1) ?? '').replace(/\.md$/i, '');
  // `<dir>/SKILL.md` (the common skill-folder layout) is named after its folder.
  if (stem.toLowerCase() === 'skill' && parts.length > 1) stem = parts.at(-2)!;
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/, '');
}

interface FrontMatter {
  fields: Partial<Record<'name' | 'description' | 'type', string>>;
  body: string;
  issues: SkillImportIssue[];
}

const KNOWN_KEYS = ['name', 'description', 'type'] as const;
const unquote = (v: string) => v.replace(/^(["'])([\s\S]*)\1$/, '$2');

/**
 * Optional `---` front matter with single-line `key: value` pairs. Only
 * name / description / type are read; other keys (and their indented or list
 * continuation lines) are ignored. Anything else is reported, never guessed.
 */
export function splitFrontMatter(text: string): FrontMatter {
  if (!text.startsWith('---\n')) return { fields: {}, body: text, issues: [] };
  const lines = text.split('\n');
  const close = lines.findIndex((l, i) => i > 0 && (l.trimEnd() === '---' || l.trimEnd() === '...'));
  if (close < 0) {
    return {
      fields: {},
      body: text,
      issues: [{ field: 'body', message: 'Front matter starts with --- but is never closed' }],
    };
  }
  const fields: FrontMatter['fields'] = {};
  const issues: SkillImportIssue[] = [];
  let lastKey: string | null = null;
  for (const line of lines.slice(1, close)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line) || line.startsWith('- ')) {
      // Continuation of the previous key (multi-line value or list).
      if (lastKey && (KNOWN_KEYS as readonly string[]).includes(lastKey)) {
        issues.push({ field: lastKey as SkillImportIssue['field'], message: `Front matter "${lastKey}" must be a single line` });
      }
      continue;
    }
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      issues.push({ field: 'body', message: `Malformed front matter line: "${line.slice(0, 60)}"` });
      lastKey = null;
      continue;
    }
    lastKey = m[1]!.toLowerCase();
    if ((KNOWN_KEYS as readonly string[]).includes(lastKey)) {
      fields[lastKey as keyof FrontMatter['fields']] = unquote(m[2]!.trim());
    }
  }
  return { fields, body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''), issues };
}

/**
 * One skill proposed from one Markdown file: front matter (if any) gives
 * name / description / type, the file name is the name fallback, the rest is
 * the body. `issues` holds every rule the item breaks right now.
 */
export function candidateFromMarkdown(path: string, text: string): SkillImportCandidate {
  const fm = splitFrontMatter(text);
  const issues = [...fm.issues];
  const rawType = fm.fields.type?.trim().toLowerCase();
  const parsedType = SkillType.safeParse(rawType);
  if (rawType && !parsedType.success) {
    issues.push({ field: 'type', message: `Unknown type "${fm.fields.type}"; choose rubric, convention, security or custom` });
  }
  const item = {
    name: fm.fields.name?.trim() || nameFromPath(path),
    description: fm.fields.description?.trim() ?? '',
    type: parsedType.success ? parsedType.data : ('custom' as const),
    body: fm.body,
  };
  return { path, ...item, issues: [...issues, ...skillImportIssues(item)] };
}
