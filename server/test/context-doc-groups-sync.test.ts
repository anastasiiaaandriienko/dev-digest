import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTEXT_DOC_GROUPS, contextDocGroupKind, contextRootOf, groupContextDocs } from '@devdigest/shared';

/**
 * The Project Context prompt groups exist once, as a vendored shared module.
 * The client keeps a copy (its "Serializes as" preview); the two must be
 * byte-identical (line endings aside) so the preview always matches the prompt.
 * Edit the server file, then copy it over the client one.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('context-doc-groups: one definition for server and client', () => {
  it('client/src/vendor/shared/context-doc-groups.ts is identical to the server copy', () => {
    expect(read('../../client/src/vendor/shared/context-doc-groups.ts')).toBe(
      read('../src/vendor/shared/context-doc-groups.ts'),
    );
  });

  it('both barrels export the groups module', () => {
    for (const side of ['../src/vendor/shared/index.ts', '../../client/src/vendor/shared/index.ts']) {
      expect(read(side)).toContain("export * from './context-doc-groups.js';");
    }
  });
});

describe('context doc groups', () => {
  const roots = ['specs', 'docs', 'insights', '.devdigest/specs', 'docs/adr', 'notes'];

  it('lists the headings in prompt order', () => {
    expect(CONTEXT_DOC_GROUPS.map((g) => g.title)).toEqual([
      'Project specifications',
      'Project docs',
      'Project insights',
      'Other project docs',
    ]);
  });

  it('classifies by the last segment of the longest containing root', () => {
    expect(contextDocGroupKind('specs/a.md', roots)).toBe('specs');
    expect(contextDocGroupKind('.devdigest/specs/a.md', roots)).toBe('specs');
    expect(contextDocGroupKind('docs/guide.md', roots)).toBe('docs');
    // docs/adr is longer than docs → its own last segment "adr" → other.
    expect(contextRootOf('docs/adr/0001.md', roots)).toBe('docs/adr');
    expect(contextDocGroupKind('docs/adr/0001.md', roots)).toBe('other');
    expect(contextDocGroupKind('insights/x.md', roots)).toBe('insights');
    expect(contextDocGroupKind('notes/n.md', roots)).toBe('other');
    expect(contextDocGroupKind('elsewhere/e.md', roots)).toBe('other');
    // Case-sensitive paths, case-insensitive kind.
    expect(contextDocGroupKind('Docs/x.md', ['Docs'])).toBe('docs');
    expect(contextDocGroupKind('docsx/x.md', ['docs'])).toBe('other');
  });

  it('groups stably and drops empty groups', () => {
    const paths = ['docs/b.md', 'notes/n.md', 'specs/s.md', 'docs/a.md'];
    expect(groupContextDocs(paths, (p) => p, roots)).toEqual([
      { kind: 'specs', title: 'Project specifications', items: ['specs/s.md'] },
      { kind: 'docs', title: 'Project docs', items: ['docs/b.md', 'docs/a.md'] },
      { kind: 'other', title: 'Other project docs', items: ['notes/n.md'] },
    ]);
    expect(groupContextDocs([], (p: string) => p, roots)).toEqual([]);
  });
});
