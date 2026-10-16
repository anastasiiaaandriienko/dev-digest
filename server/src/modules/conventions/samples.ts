import type { Dirent } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  CONFIG_FILE_RE,
  CONFIG_SKIP_DIRS,
  MAX_CONFIG_FILES,
  MAX_CONFIG_BYTES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  REDACTED_MARK,
  SECRET_ASSIGNMENT_RE,
  SECRET_PATTERNS,
  SENSITIVE_PATH_RE,
} from './constants.js';

/** One file as it will be shown to the model (and used to ground evidence). */
export interface SampleFile {
  path: string;
  kind: 'config' | 'source';
  /** The text actually sent (possibly cut at a line boundary, secrets redacted). */
  lines: string[];
  truncated: boolean;
  redactions: number;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface SampleSelection {
  files: SampleFile[];
  skipped: SkippedFile[];
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const CONTROL_RE = /[\u0000-\u001F]/;

/** Why a repo-relative path must not be read, or null. */
export function unsafeRepoPath(rel: string): string | null {
  if (!rel || rel.length > 500) return 'empty or over-long path';
  if (isAbsolute(rel) || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return 'absolute path';
  if (rel.includes('\\') || CONTROL_RE.test(rel)) return 'invalid characters';
  if (rel.split('/').some((s) => s === '..' || s === '' || s === '.')) return 'path traversal';
  if (SENSITIVE_PATH_RE.test(rel)) return 'sensitive file';
  return null;
}

/** Replace secret-looking values; the line structure (and so every line number) is kept. */
export function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match: string) => {
      redactions++;
      const newlines = match.split('\n').length - 1;
      return REDACTED_MARK + '\n'.repeat(newlines);
    });
  }
  // `password = "..."`-style assignments keep the key, so the code still reads as code.
  out = out.replace(SECRET_ASSIGNMENT_RE, (_m: string, key: string, quote: string) => {
    redactions++;
    return `${key}${quote}${REDACTED_MARK}${quote}`;
  });
  return { text: out, redactions };
}

/**
 * Read one file of the clone safely: the entry must be a regular file (no
 * symlink), its real path must stay inside the clone's real path, at most
 * `maxBytes` are read (cut at the last newline), and it must be UTF-8 text
 * without NUL bytes.
 */
export async function readCloneFile(
  cloneRoot: string,
  rel: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean } | { skip: string }> {
  const unsafe = unsafeRepoPath(rel);
  if (unsafe) return { skip: unsafe };
  const full = join(cloneRoot, ...rel.split('/'));
  try {
    const st = await lstat(full);
    if (st.isSymbolicLink()) return { skip: 'symbolic link' };
    if (!st.isFile()) return { skip: 'not a regular file' };
    const real = await realpath(full);
    const inside = relative(cloneRoot, real);
    if (!inside || isAbsolute(inside) || inside.split(sep).includes('..')) return { skip: 'outside the repository' };

    // Read only what can be kept (+1 byte to know whether the file is longer).
    const handle = await open(real, 'r');
    let head: Buffer;
    try {
      const buf = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      head = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    if (head.includes(0)) return { skip: 'binary file' };
    const longer = head.length > maxBytes;
    // When cut, end at the last newline: never inside a line or a multi-byte character.
    const end = longer ? head.lastIndexOf(0x0a, maxBytes - 1) : head.length;
    if (end <= 0) return { skip: 'single line longer than the limit' };
    let text: string;
    try {
      text = utf8.decode(head.subarray(0, end));
    } catch {
      return { skip: 'not UTF-8 text' };
    }
    return { text: text.replace(/\r\n?/g, '\n'), truncated: longer };
  } catch {
    return { skip: 'unreadable' };
  }
}

const configNames = (entries: Dirent[]) =>
  entries
    .filter((e) => e.isFile() && CONFIG_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort();

/**
 * Config files of the repo root, then of each first-level package directory
 * (a monorepo keeps its tsconfig in `server/`, `client/`, ...). Dot-dirs and
 * build / dependency folders are skipped; at most MAX_CONFIG_FILES paths.
 * Throws only when the root itself cannot be listed.
 */
export async function findConfigFiles(cloneRoot: string): Promise<string[]> {
  const rootEntries = await readdir(cloneRoot, { withFileTypes: true });
  const found = configNames(rootEntries);
  const dirs = rootEntries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !CONFIG_SKIP_DIRS.has(e.name))
    .map((e) => e.name)
    .sort();
  for (const dir of dirs) {
    if (found.length >= MAX_CONFIG_FILES) break;
    try {
      const entries = await readdir(join(cloneRoot, dir), { withFileTypes: true });
      for (const name of configNames(entries)) found.push(`${dir}/${name}`);
    } catch {
      // An unreadable package folder only means fewer config samples.
    }
  }
  return found.slice(0, MAX_CONFIG_FILES);
}

/**
 * HW2 #39 — pick what the model sees with code only (no LLM): the repo's
 * config files (tsconfig / eslint / prettier / editorconfig / biome, at the
 * root and in first-level package folders) and the
 * top-ranked source files from repo-intel, each read safely, secrets redacted,
 * within per-file and total size budgets.
 */
export async function selectConventionSamples(clonePath: string, rankedFiles: readonly string[]): Promise<SampleSelection> {
  const files: SampleFile[] = [];
  const skipped: SkippedFile[] = [];
  let cloneRoot: string;
  try {
    cloneRoot = await realpath(clonePath);
  } catch {
    return { files, skipped: [{ path: '.', reason: 'repository clone not found' }] };
  }

  let configs: string[] = [];
  try {
    configs = await findConfigFiles(cloneRoot);
  } catch {
    skipped.push({ path: '.', reason: 'repository root unreadable' });
  }

  let total = 0;
  const seen = new Set<string>();
  const add = async (rel: string, kind: SampleFile['kind'], max: number) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const budget = Math.min(max, MAX_TOTAL_BYTES - total);
    if (budget < 256) {
      skipped.push({ path: rel, reason: 'sample budget exhausted' });
      return;
    }
    const read = await readCloneFile(cloneRoot, rel, budget);
    if ('skip' in read) {
      skipped.push({ path: rel, reason: read.skip });
      return;
    }
    const red = redactSecrets(read.text);
    if (!red.text.trim()) {
      skipped.push({ path: rel, reason: 'empty file' });
      return;
    }
    total += Buffer.byteLength(red.text, 'utf8');
    files.push({ path: rel, kind, lines: red.text.split('\n'), truncated: read.truncated, redactions: red.redactions });
  };

  for (const c of configs) await add(c, 'config', MAX_CONFIG_BYTES);
  for (const f of rankedFiles) await add(f.replace(/\\/g, '/'), 'source', MAX_FILE_BYTES);
  return { files, skipped };
}
