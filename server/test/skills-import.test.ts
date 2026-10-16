import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { SKILL_IMPORT_LIMITS, findExecutableContent, skillImportIssues } from '@devdigest/shared';
import { AppError } from '../src/platform/errors.js';
import { candidateFromMarkdown, nameFromPath, splitFrontMatter } from '../src/modules/skills/import/markdown.js';
import { decodeBase64, parseImportFile } from '../src/modules/skills/import/parse-file.js';
import { inspectZip, unsafeEntryName } from '../src/modules/skills/import/zip.js';
import { crc32 } from '../src/modules/skills/import/crc32.js';
import { duplicateNames, markDuplicates } from '../src/modules/skills/helpers.js';
import { buildZip, toBase64 } from './helpers/zip-builder.js';

/**
 * HW2 #15 — skill import parsing, pure (no DB): .md front matter, name / type
 * / body rules, and the ZIP safety gate (traversal, symlinks, encryption,
 * zip bombs, lying headers, limits, non-Markdown entries).
 */

const MD = '---\nname: api-breaking-changes\ndescription: Flag removed fields\ntype: security\n---\n\n# Breaking changes\nFlag removed response fields.\n';
const u8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

/** The AppError a call throws (fails the test when nothing is thrown). */
function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error('expected an error');
}
const reasons = (e: AppError) => ((e.details as { entries: { path: string; reason: string }[] }).entries ?? []).map((x) => `${x.path}: ${x.reason}`);

describe('Markdown → candidate', () => {
  it('reads name / description / type from front matter; the rest is the body', () => {
    const c = candidateFromMarkdown('x.md', MD);
    expect(c).toMatchObject({ path: 'x.md', name: 'api-breaking-changes', description: 'Flag removed fields', type: 'security', issues: [] });
    expect(c.body).toBe('# Breaking changes\nFlag removed response fields.\n');
  });

  it('without front matter: name from the file (SKILL.md → its folder), type custom, whole text is the body', () => {
    expect(candidateFromMarkdown('My Rule_v2.md', '# Hi\nbody')).toMatchObject({ name: 'my-rule-v2', type: 'custom', description: '', body: '# Hi\nbody', issues: [] });
    expect(nameFromPath('skills/Response-Schema/SKILL.md')).toBe('response-schema');
  });

  it('quoted values; unknown keys and their list lines are ignored', () => {
    const fm = splitFrontMatter('---\nname: "a-b"\nallowed-tools:\n  - Read\n- Grep\ntype: \'rubric\'\n---\nbody');
    expect(fm).toEqual({ fields: { name: 'a-b', type: 'rubric' }, body: 'body', issues: [] });
  });

  it('malformed front matter is reported, never guessed', () => {
    expect(candidateFromMarkdown('a.md', '---\nname: a\n# body without closing').issues.map((i) => i.message)).toContain(
      'Front matter starts with --- but is never closed',
    );
    expect(candidateFromMarkdown('a.md', '---\nname: a\nthis is not yaml\n---\nbody').issues).toEqual([
      { field: 'body', message: 'Malformed front matter line: "this is not yaml"' },
    ]);
    expect(candidateFromMarkdown('a.md', '---\ndescription: >\n  folded\n---\nbody').issues).toEqual([
      { field: 'description', message: 'Front matter "description" must be a single line' },
    ]);
  });

  it('an unknown type falls back to custom with an issue', () => {
    const c = candidateFromMarkdown('a.md', '---\ntype: linter\n---\nbody');
    expect(c.type).toBe('custom');
    expect(c.issues).toEqual([{ field: 'type', message: 'Unknown type "linter"; choose rubric, convention, security or custom' }]);
  });

  it('name, body and description rules', () => {
    const base = { name: 'ok-name', description: '', type: 'custom', body: '# x' };
    expect(skillImportIssues(base)).toEqual([]);
    for (const name of ['Bad Name', 'UPPER', '-lead', 'trail-', 'a/b', '../x', '']) {
      expect(skillImportIssues({ ...base, name }).map((i) => i.field)).toContain('name');
    }
    expect(skillImportIssues({ ...base, name: 'a'.repeat(121) })[0]!.field).toBe('name');
    expect(skillImportIssues({ ...base, body: '  \n ' })).toEqual([{ field: 'body', message: 'Body is empty' }]);
    expect(skillImportIssues({ ...base, body: 'x'.repeat(200_001) })[0]!.field).toBe('body');
    expect(skillImportIssues({ ...base, type: 'linter' })[0]!.field).toBe('type');
    expect(skillImportIssues({ ...base, description: 'd'.repeat(2001) })[0]!.field).toBe('description');
    expect(skillImportIssues({ ...base, body: 'a\u0000b' })[0]!.message).toBe('Contains control or bidi characters');
    expect(skillImportIssues({ ...base, body: 'a\u202Eb' })[0]!.message).toBe('Contains control or bidi characters');
  });

  it('executable content is rejected in prose but allowed inside code', () => {
    for (const bad of [
      '<script>alert(1)</script>',
      '<SCRIPT src=x>',
      '<iframe src="https://x">',
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '[click](javascript:alert(1))',
      '<a href="data:text/html;base64,xx">',
      '<meta http-equiv="refresh" content="0">',
      '<object data=x>',
    ]) {
      expect(findExecutableContent(`# Rule\n${bad}`), bad).not.toBeNull();
    }
    expect(findExecutableContent('Flag `<script>` tags and `javascript:` URLs.')).toBeNull();
    expect(findExecutableContent('# XSS\n```html\n<script>alert(1)</script>\n<img onerror=x>\n```\nok')).toBeNull();
    expect(findExecutableContent('```\n<script>\n')).not.toBeNull(); // unclosed fence: still scanned
    expect(skillImportIssues({ name: 'x', description: '', type: 'custom', body: '<script>x</script>' })[0]!.message).toMatch(
      /^Executable content is not allowed/,
    );
  });
});

describe('parseImportFile — .md', () => {
  it('one candidate from a .md file', () => {
    const r = parseImportFile('rules/api.MD', u8(MD));
    expect(r.format).toBe('md');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]!.path).toBe('api.MD');
  });

  it('rejects other file types (415), empty (422) and oversized files (413)', () => {
    for (const f of ['skill.exe', 'skill.sh', 'skill.js', 'skill.txt', 'skill.md.exe', 'skill']) {
      expect(errorOf(() => parseImportFile(f, u8('# x'))).statusCode, f).toBe(415);
    }
    expect(errorOf(() => parseImportFile('a.md', new Uint8Array())).statusCode).toBe(422);
    expect(errorOf(() => parseImportFile('a.md', new Uint8Array(SKILL_IMPORT_LIMITS.maxEntryBytes + 1).fill(0x61))).statusCode).toBe(413);
    expect(errorOf(() => parseImportFile('a.zip', new Uint8Array(SKILL_IMPORT_LIMITS.maxUploadBytes + 1))).statusCode).toBe(413);
  });

  it('rejects binaries and scripts disguised as .md, and non-UTF-8 text', () => {
    expect(errorOf(() => parseImportFile('a.md', new Uint8Array([0x4d, 0x5a, 0x90, 0]))).message).toMatch(/MZ/);
    expect(errorOf(() => parseImportFile('a.md', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1]))).message).toMatch(/ELF/);
    expect(errorOf(() => parseImportFile('a.md', u8('#!/bin/sh\nrm -rf /'))).message).toMatch(/#!/);
    expect(errorOf(() => parseImportFile('a.md', buildZip([{ name: 'a.md', data: '# x' }]))).message).toMatch(/ZIP/);
    expect(errorOf(() => parseImportFile('a.md', new Uint8Array([0x23, 0x20, 0xff, 0xfe]))).message).toMatch(/UTF-8/);
  });

  it('strict base64', () => {
    expect(decodeBase64(toBase64('# x'))).toEqual(u8('# x'));
    for (const bad of ['###', 'abc', 'YWJj\n', 'YW=j']) expect(() => decodeBase64(bad), bad).toThrow(/base64/);
  });
});

describe('parseImportFile — .zip', () => {
  it('extracts every .md (stored + deflate), ignores directories and macOS metadata', () => {
    const zip = buildZip([
      { name: 'skills/' },
      { name: 'skills/b.md', data: '# B', method: 0 },
      { name: 'skills/a/SKILL.md', data: MD },
      { name: '__MACOSX/skills/._b.md', data: 'x' },
      { name: 'skills/.DS_Store', data: 'x' },
    ]);
    const r = parseImportFile('pack.zip', zip);
    expect(r.format).toBe('zip');
    expect(r.candidates.map((c) => [c.path, c.name])).toEqual([
      ['skills/a/SKILL.md', 'api-breaking-changes'],
      ['skills/b.md', 'b'],
    ]);
    expect(r.skipped).toEqual(['skills/', '__MACOSX/skills/._b.md', 'skills/.DS_Store']);
  });

  it('works with archives produced by a real ZIP library (fflate)', () => {
    const zip = zipSync({ 'one.md': strToU8('# One'), 'dir/two.md': strToU8(MD) });
    expect(parseImportFile('x.zip', zip).candidates.map((c) => c.name)).toEqual(['api-breaking-changes', 'one']);
  });

  it.each([
    ['../evil.md', 'path traversal (..)'],
    ['skills/../../evil.md', 'path traversal (..)'],
    ['/etc/evil.md', 'absolute path'],
    ['C:/evil.md', 'drive-letter path'],
    ['skills\\..\\evil.md', 'backslash in path'],
    ['a//b.md', 'empty or "." path segment'],
    ['./a.md', 'empty or "." path segment'],
    ['a\u0001.md', 'control character in name'],
  ])('rejects the whole archive for an unsafe path: %s', (name, reason) => {
    const e = errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'ok.md', data: '# ok' }, { name, data: '# x' }])));
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe('unsafe_archive');
    expect(reasons(e)).toEqual([`${name}: ${reason}`]);
  });

  it('rejects symlinks, devices, encrypted entries and non-Markdown entries', () => {
    const e = errorOf(() =>
      parseImportFile(
        'x.zip',
        buildZip([
          { name: 'link.md', data: '/etc/passwd', unixMode: 0o120777 },
          { name: 'fifo.md', data: '', unixMode: 0o010644 },
          { name: 'secret.md', data: '# x', flags: 0x1 },
          { name: 'run.sh', data: 'echo hi' },
          { name: 'tool.exe', data: 'MZ' },
          { name: 'notes.txt', data: 'x' },
          { name: 'regular.md', data: '# ok', unixMode: 0o100644 },
        ]),
      ),
    );
    expect(reasons(e)).toEqual([
      'link.md: symbolic link',
      'fifo.md: not a regular file',
      'secret.md: encrypted entry',
      'run.sh: only .md files can be imported',
      'tool.exe: only .md files can be imported',
      'notes.txt: only .md files can be imported',
    ]);
  });

  it('zip bombs: a too-high compression ratio, an oversized entry, or too much in total', () => {
    const bomb = 'a'.repeat(400_000); // deflates ~1000:1
    expect(reasons(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'bomb.md', data: bomb }]))))[0]).toMatch(
      /compression ratio above 100:1/,
    );
    const big = Buffer.alloc(SKILL_IMPORT_LIMITS.maxEntryBytes + 1, 'x');
    expect(reasons(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'big.md', data: big, method: 0 }]))))).toEqual([
      `big.md: larger than ${SKILL_IMPORT_LIMITS.maxEntryBytes} bytes uncompressed`,
    ]);
    // Within the upload limit but over the total: declared sizes are summed before anything is inflated.
    // (stored, so each entry's ratio stays under 100:1: only the total trips)
    const lies = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.md`, data: '# x'.repeat(2000), method: 0, declaredSize: 500_000 }));
    expect(reasons(errorOf(() => inspectZip(buildZip(lies))))).toEqual([
      `(archive): more than ${SKILL_IMPORT_LIMITS.maxTotalBytes} bytes uncompressed in total`,
    ]);
  });

  it('headers that lie about the size or checksum are caught after inflating', () => {
    const e1 = errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: '# real content', declaredSize: 5 }])));
    expect(e1.code).toBe('unsafe_archive');
    const e2 = errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: '# real content', declaredCrc: 1234 }])));
    expect(reasons(e2)).toEqual(['a.md: content does not match its declared size or checksum']);
  });

  it('rejects malformed and unsupported archive structures', () => {
    const good = buildZip([{ name: 'a.md', data: '# a' }]);
    expect(errorOf(() => parseImportFile('x.zip', u8('not a zip at all, just text'))).message).toMatch(/Not a ZIP/);
    expect(errorOf(() => parseImportFile('x.zip', good.subarray(0, good.length - 30))).code).toBe('unsafe_archive'); // truncated
    expect(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: '# a' }], { trailing: u8('junk') }))).message).toMatch(
      /Malformed/,
    );
    expect(reasons(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: '# a', method: 14 }]))))).toEqual([
      'a.md: unsupported compression method 14',
    ]);
    expect(reasons(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: '# a', localName: 'b.md' }]))))).toEqual([
      'a.md: local header does not match the central directory',
    ]);
    expect(reasons(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'A.md', data: '# a' }, { name: 'a.md', data: '# b' }]))))).toEqual([
      'a.md: duplicate entry',
    ]);
    const zip64 = Buffer.from(good);
    zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16);
    expect(errorOf(() => parseImportFile('x.zip', zip64)).message).toMatch(/ZIP64/);
    expect(errorOf(() => parseImportFile('x.zip', buildZip([]))).message).toMatch(/empty/);
    expect(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'dir/' }]))).message).toMatch(/no \.md/);
    const many = Array.from({ length: SKILL_IMPORT_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `s${i}.md`, data: '# x' }));
    expect(errorOf(() => parseImportFile('x.zip', buildZip(many))).message).toMatch(/Too many entries/);
  });

  it('a binary entry named .md rejects the archive', () => {
    expect(errorOf(() => parseImportFile('x.zip', buildZip([{ name: 'a.md', data: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1]) }]))).message).toMatch(
      /ELF/,
    );
  });

  it('crc32 matches the standard check value and the CRCs fflate writes', () => {
    expect(crc32(u8('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    // fflate computes its own CRC when zipping; inspectZip reads it back from the central directory.
    const data = strToU8(Array.from({ length: 300 }, (_, i) => `- rule ${(i * 7919) % 1009}: flag ${i}`).join('\n'));
    expect(inspectZip(zipSync({ 'r.md': data })).markdown[0]!.crc).toBe(crc32(data));
  });

  it('unsafeEntryName accepts normal relative paths', () => {
    expect(unsafeEntryName('skills/api/SKILL.md')).toBeNull();
    expect(unsafeEntryName('dir/')).toBeNull();
  });
});

describe('duplicate names', () => {
  it('duplicateNames is case-insensitive and keeps the first spelling', () => {
    expect(duplicateNames(['a', 'B', 'b', 'c', 'A'])).toEqual(['a', 'B']);
  });

  it('markDuplicates flags names taken in the workspace and names repeated in the file', () => {
    const c = (name: string) => ({ path: `${name}.md`, name, description: '', type: 'custom' as const, body: '# x', issues: [] });
    const out = markDuplicates([c('taken'), c('twice'), c('Twice'), c('fresh')], ['TAKEN']);
    expect(out.map((x) => x.issues.map((i) => i.message))).toEqual([
      ['A skill named "taken" already exists'],
      ['"twice" is used by more than one file'],
      ['"Twice" is used by more than one file'],
      [],
    ]);
  });
});
