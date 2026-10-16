/** Archive entries that are metadata, not content: ignored (still path-checked). */
export const IGNORED_ENTRY_RE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

/** The only file type a skill can be imported from (a .zip holds .md files). */
export const MARKDOWN_EXT_RE = /\.md$/i;

/** Leading bytes of executables / archives that must never pass as Markdown. */
export const FORBIDDEN_MAGIC: readonly (readonly [string, number[]])[] = [
  ['Windows executable (MZ)', [0x4d, 0x5a]],
  ['ELF executable', [0x7f, 0x45, 0x4c, 0x46]],
  ['Mach-O executable', [0xcf, 0xfa, 0xed, 0xfe]],
  ['Mach-O executable', [0xfe, 0xed, 0xfa, 0xcf]],
  ['script with a #! interpreter line', [0x23, 0x21]],
  ['ZIP archive', [0x50, 0x4b, 0x03, 0x04]],
];

/** ZIP record signatures (APPNOTE 4.3). */
export const ZIP_SIG = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
} as const;

/** Fixed sizes of ZIP records, without their variable-length fields. */
export const ZIP_SIZE = { local: 30, central: 46, end: 22, maxComment: 0xffff } as const;
