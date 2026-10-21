import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { isCliEntry } from '../src/db/migrate.js';

describe('migrate CLI entry guard', () => {
  it('matches the script path of this platform', () => {
    const script = process.platform === 'win32' ? 'D:\\repo\\server\\src\\db\\migrate.ts' : '/repo/server/src/db/migrate.ts';
    expect(isCliEntry(pathToFileURL(script).href, script)).toBe(true);
  });

  it.skipIf(process.platform !== 'win32')('matches a Windows drive path with backslashes', () => {
    expect(isCliEntry('file:///D:/AI/dev-digest/server/src/db/migrate.ts', 'D:\\AI\\dev-digest\\server\\src\\db\\migrate.ts')).toBe(true);
  });

  it('does not match another script or a missing argv[1]', () => {
    const url = pathToFileURL(process.platform === 'win32' ? 'D:\\repo\\migrate.ts' : '/repo/migrate.ts').href;
    expect(isCliEntry(url, process.platform === 'win32' ? 'D:\\repo\\seed.ts' : '/repo/seed.ts')).toBe(false);
    expect(isCliEntry(url, undefined)).toBe(false);
  });
});
