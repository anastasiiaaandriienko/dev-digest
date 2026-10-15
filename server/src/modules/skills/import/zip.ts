import { crc32 } from './crc32.js';
import { unzipSync } from 'fflate';
import { SKILL_IMPORT_LIMITS } from '@devdigest/shared';
import { AppError } from '../../../platform/errors.js';
import { IGNORED_ENTRY_RE, MARKDOWN_EXT_RE, ZIP_SIG, ZIP_SIZE } from './constants.js';

/** One archive entry that failed a safety check. */
export interface RejectedEntry {
  path: string;
  reason: string;
}

/** A .zip that cannot be imported; `details.entries` says which entry and why. */
export class UnsafeArchiveError extends AppError {
  constructor(message: string, entries: RejectedEntry[] = []) {
    super('unsafe_archive', message, 422, { entries });
  }
}

/** What the central directory declares about an entry (nothing is inflated yet). */
export interface ZipEntryMeta {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
}

export interface InspectedZip {
  /** The .md entries to extract. */
  markdown: ZipEntryMeta[];
  /** Directories and metadata entries that were ignored. */
  skipped: string[];
}

const S_IFMT = 0xf000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;
const HOST_UNIX = 3;
const FLAG_ENCRYPTED = 0x1;
const FLAG_STRONG_ENCRYPTION = 0x40;
const FLAG_UTF8 = 0x800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Why an entry name is unsafe to use as a path, or null. */
export function unsafeEntryName(name: string): string | null {
  if (name.length === 0 || name.length > 255) return 'empty or over-long name';
  if (/[\u0000-\u001F\u007F]/.test(name)) return 'control character in name';
  if (name.includes('\\')) return 'backslash in path';
  if (name.startsWith('/')) return 'absolute path';
  if (/^[a-zA-Z]:/.test(name)) return 'drive-letter path';
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((s) => s === '..')) return 'path traversal (..)';
  if (segments.some((s) => s === '' || s === '.')) return 'empty or "." path segment';
  return null;
}

function findEnd(view: DataView): number {
  const last = view.byteLength - ZIP_SIZE.end;
  const first = Math.max(0, last - ZIP_SIZE.maxComment);
  for (let at = last; at >= first; at--) {
    if (view.getUint32(at, true) === ZIP_SIG.end) return at;
  }
  return -1;
}

/**
 * Read the ZIP central directory and decide, before anything is inflated,
 * whether the archive may be imported. Unsupported structures (zip64,
 * multi-disk, encryption, unknown compression) are rejected rather than parsed
 * leniently; every entry must have a safe relative path, be a regular file or a
 * directory (no symlinks / devices), be Markdown (or ignorable metadata), and
 * stay within the size, count and compression-ratio limits.
 */
export function inspectZip(bytes: Uint8Array): InspectedZip {
  const L = SKILL_IMPORT_LIMITS;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < ZIP_SIZE.end) throw new UnsafeArchiveError('Not a ZIP archive');
  const end = findEnd(view);
  if (end < 0) throw new UnsafeArchiveError('Not a ZIP archive (no end of central directory)');

  const disk = view.getUint16(end + 4, true);
  const cdDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entries = view.getUint16(end + 10, true);
  const cdSize = view.getUint32(end + 12, true);
  const cdOffset = view.getUint32(end + 16, true);
  const commentLength = view.getUint16(end + 20, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new UnsafeArchiveError('ZIP64 archives are not supported');
  }
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entries) {
    throw new UnsafeArchiveError('Multi-part archives are not supported');
  }
  if (end + ZIP_SIZE.end + commentLength !== bytes.byteLength || cdOffset + cdSize !== end) {
    throw new UnsafeArchiveError('Malformed ZIP archive (unexpected data around the central directory)');
  }
  if (entries === 0) throw new UnsafeArchiveError('The archive is empty');
  if (entries > L.maxEntries) {
    throw new UnsafeArchiveError(`Too many entries: ${entries} (max ${L.maxEntries})`);
  }

  const rejected: RejectedEntry[] = [];
  const markdown: ZipEntryMeta[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  let at = cdOffset;

  for (let i = 0; i < entries; i++) {
    if (at + ZIP_SIZE.central > end || view.getUint32(at, true) !== ZIP_SIG.central) {
      throw new UnsafeArchiveError('Malformed ZIP central directory');
    }
    const madeBy = view.getUint16(at + 4, true);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    const localOffset = view.getUint32(at + 42, true);
    const next = at + ZIP_SIZE.central + nameLength + extraLength + commentLen;
    if (next > end) throw new UnsafeArchiveError('Malformed ZIP central directory');

    const rawName = bytes.subarray(at + ZIP_SIZE.central, at + ZIP_SIZE.central + nameLength);
    at = next;
    let name: string;
    try {
      // Non-UTF-8 (CP437) names are only accepted when they are plain ASCII.
      name = utf8.decode(rawName);
      if (!(flags & FLAG_UTF8) && /[^\x20-\x7e]/.test(name)) throw new Error('non-ascii');
    } catch {
      rejected.push({ path: `entry #${i + 1}`, reason: 'name is not valid UTF-8' });
      continue;
    }
    const reject = (reason: string) => rejected.push({ path: name, reason });

    const unsafe = unsafeEntryName(name);
    if (unsafe) {
      reject(unsafe);
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      reject('duplicate entry');
      continue;
    }
    seen.add(key);

    const mode = (external >>> 16) & S_IFMT;
    if ((madeBy >>> 8) === HOST_UNIX && mode !== 0 && mode !== S_IFREG && mode !== S_IFDIR) {
      reject(mode === 0xa000 ? 'symbolic link' : 'not a regular file');
      continue;
    }
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) {
      reject('encrypted entry');
      continue;
    }
    if (name.endsWith('/')) {
      if (size !== 0) reject('directory entry with content');
      else skipped.push(name);
      continue;
    }
    if (IGNORED_ENTRY_RE.test(name)) {
      skipped.push(name);
      continue;
    }
    if (!MARKDOWN_EXT_RE.test(name)) {
      reject('only .md files can be imported');
      continue;
    }
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      reject(`unsupported compression method ${method}`);
      continue;
    }
    if (size > L.maxEntryBytes) {
      reject(`larger than ${L.maxEntryBytes} bytes uncompressed`);
      continue;
    }
    if (size > 0 && (compressedSize === 0 || size / compressedSize > L.maxCompressionRatio)) {
      reject(`compression ratio above ${L.maxCompressionRatio}:1 (possible zip bomb)`);
      continue;
    }
    // The local header must agree with the central directory (no hidden data / renamed entries).
    if (
      localOffset + ZIP_SIZE.local > cdOffset ||
      view.getUint32(localOffset, true) !== ZIP_SIG.local ||
      view.getUint16(localOffset + 8, true) !== method ||
      (view.getUint16(localOffset + 6, true) & FLAG_ENCRYPTED) !== 0
    ) {
      reject('local header does not match the central directory');
      continue;
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + ZIP_SIZE.local + localNameLength + localExtra;
    const localName = bytes.subarray(localOffset + ZIP_SIZE.local, localOffset + ZIP_SIZE.local + localNameLength);
    if (Buffer.compare(Buffer.from(localName), Buffer.from(rawName)) !== 0 || dataStart + compressedSize > cdOffset) {
      reject('local header does not match the central directory');
      continue;
    }
    total += size;
    markdown.push({ name, method, compressedSize, size, crc });
  }

  if (total > L.maxTotalBytes) {
    rejected.push({ path: '(archive)', reason: `more than ${L.maxTotalBytes} bytes uncompressed in total` });
  }
  if (rejected.length > 0) {
    throw new UnsafeArchiveError(
      `The archive cannot be imported: ${rejected.length} unsafe or unsupported entr${rejected.length === 1 ? 'y' : 'ies'}`,
      rejected,
    );
  }
  return { markdown, skipped };
}

/**
 * Inspect, then extract only the vetted .md entries with fflate. Each output is
 * re-checked against the declared size and CRC-32, so an entry whose headers
 * lie about its size cannot slip past the limits.
 */
export function extractMarkdown(bytes: Uint8Array): { files: { path: string; bytes: Uint8Array }[]; skipped: string[] } {
  const { markdown, skipped } = inspectZip(bytes);
  const wanted = new Map(markdown.map((m) => [m.name, m]));
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
  } catch (e) {
    throw new UnsafeArchiveError(`Corrupt ZIP archive: ${(e as Error).message}`);
  }
  const bad: RejectedEntry[] = [];
  const files = markdown.map((m) => {
    const data = out[m.name];
    if (!data || data.byteLength !== m.size || crc32(data) !== m.crc) {
      bad.push({ path: m.name, reason: 'content does not match its declared size or checksum' });
    }
    return { path: m.name, bytes: data ?? new Uint8Array() };
  });
  if (bad.length > 0) throw new UnsafeArchiveError('Corrupt ZIP archive', bad);
  return { files, skipped };
}
