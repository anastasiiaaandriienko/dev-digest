import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SMART_GROUP_ORDER, SmartDiffRole } from '@devdigest/shared';

/**
 * The Smart Diff classification rules exist once, as a vendored shared module.
 * The client keeps a copy (its own `@devdigest/shared` alias); the two must be
 * byte-identical (line endings aside) so server and client never classify a
 * file differently. Edit the server file, then copy it over the client one.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

describe('smart-diff-rules: one definition for server and client', () => {
  it('client/src/vendor/shared/smart-diff-rules.ts is identical to the server copy', () => {
    expect(read('../../client/src/vendor/shared/smart-diff-rules.ts')).toBe(read('../src/vendor/shared/smart-diff-rules.ts'));
  });

  it('both barrels export the rules module', () => {
    for (const side of ['../src/vendor/shared/index.ts', '../../client/src/vendor/shared/index.ts']) {
      expect(read(side)).toContain("export * from './smart-diff-rules.js';");
    }
  });

  it('the SmartDiff contract roles are the rule groups, in display order', () => {
    expect(SmartDiffRole.options).toEqual([...SMART_GROUP_ORDER]);
  });
});
