import { SKILL_IMPORT_LIMITS, type SkillImportCandidate } from '@devdigest/shared';
import { AppError, ValidationError } from '../../../platform/errors.js';
import { candidateFromMarkdown, decodeText, forbiddenMagic } from './markdown.js';
import { extractMarkdown, UnsafeArchiveError } from './zip.js';

export interface ParsedImportFile {
  format: 'md' | 'zip';
  candidates: SkillImportCandidate[];
  skipped: string[];
}

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Strict base64 → bytes (Buffer.from alone silently skips invalid characters). */
export function decodeBase64(content: string): Uint8Array {
  if (!BASE64_RE.test(content)) throw new ValidationError('File content is not valid base64');
  return new Uint8Array(Buffer.from(content, 'base64'));
}

function markdownText(path: string, bytes: Uint8Array): string {
  const magic = forbiddenMagic(bytes);
  if (magic) throw new UnsafeArchiveError(`"${path}" is not Markdown (${magic})`, [{ path, reason: magic }]);
  if (bytes.byteLength > SKILL_IMPORT_LIMITS.maxEntryBytes) {
    throw new AppError('file_too_large', `"${path}" is larger than ${SKILL_IMPORT_LIMITS.maxEntryBytes} bytes`, 413);
  }
  const text = decodeText(bytes);
  if (text === null) throw new UnsafeArchiveError(`"${path}" is not UTF-8 text`, [{ path, reason: 'not UTF-8 text' }]);
  return text;
}

/**
 * Turn an uploaded `.md` or `.zip` into proposed skills (nothing is saved).
 * Unsupported types → 415; over the size limit → 413; unsafe / malformed
 * archives and binary "Markdown" → 422 with the offending entries.
 */
export function parseImportFile(filename: string, bytes: Uint8Array): ParsedImportFile {
  const lower = filename.toLowerCase();
  const format = lower.endsWith('.md') ? 'md' : lower.endsWith('.zip') ? 'zip' : null;
  if (!format) {
    throw new AppError('unsupported_file_type', 'Only .md and .zip files can be imported', 415, { filename });
  }
  if (bytes.byteLength === 0) throw new ValidationError('The file is empty');
  if (bytes.byteLength > SKILL_IMPORT_LIMITS.maxUploadBytes) {
    throw new AppError('file_too_large', `The file is larger than ${SKILL_IMPORT_LIMITS.maxUploadBytes} bytes`, 413);
  }

  if (format === 'md') {
    const name = filename.split(/[\\/]/).at(-1)!;
    return { format, candidates: [candidateFromMarkdown(name, markdownText(name, bytes))], skipped: [] };
  }

  const { files, skipped } = extractMarkdown(bytes);
  if (files.length === 0) throw new ValidationError('The archive contains no .md files');
  if (files.length > SKILL_IMPORT_LIMITS.maxItems) {
    throw new ValidationError(`The archive contains more than ${SKILL_IMPORT_LIMITS.maxItems} skills`);
  }
  const candidates = files
    .map((f) => candidateFromMarkdown(f.path, markdownText(f.path, f.bytes)))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { format, candidates, skipped };
}
