import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns defaults for an empty env', () => {
    expect(loadConfig({})).toEqual({
      apiBase: 'http://localhost:3001',
      requestTimeoutMs: 15_000,
      runTimeoutMs: 50_000,
      pollIntervalMs: 3_000,
    });
  });

  it('removes trailing slashes', () => {
    expect(loadConfig({ DEVDIGEST_API_BASE: 'http://api.test:8080/' }).apiBase).toBe('http://api.test:8080');
    expect(loadConfig({ DEVDIGEST_API_BASE: 'https://api.test/v1//' }).apiBase).toBe('https://api.test/v1');
  });

  it('rejects unparsable and non-http(s) URLs', () => {
    expect(() => loadConfig({ DEVDIGEST_API_BASE: 'not a url' })).toThrow(/http\(s\)/);
    expect(() => loadConfig({ DEVDIGEST_API_BASE: 'ftp://x.test' })).toThrow(/http\(s\)/);
    expect(() => loadConfig({ DEVDIGEST_API_BASE: 'file:///etc/passwd' })).toThrow(/http\(s\)/);
  });

  it('rejects URLs with credentials without echoing them', () => {
    let msg = '';
    try {
      loadConfig({ DEVDIGEST_API_BASE: 'http://user:secret@x.test' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/credentials/);
    expect(msg).not.toContain('secret');
    expect(() => loadConfig({ DEVDIGEST_API_BASE: 'http://user@x.test' })).toThrow(/credentials/);
  });

  it('accepts integer env values within bounds', () => {
    const c = loadConfig({
      DEVDIGEST_REQUEST_TIMEOUT_MS: '2000',
      DEVDIGEST_RUN_TIMEOUT_MS: '600000',
      DEVDIGEST_POLL_INTERVAL_MS: '2000',
    });
    expect(c).toMatchObject({ requestTimeoutMs: 2000, runTimeoutMs: 600_000, pollIntervalMs: 2000 });
  });

  it('treats blank values as default', () => {
    expect(loadConfig({ DEVDIGEST_RUN_TIMEOUT_MS: '  ' }).runTimeoutMs).toBe(50_000);
  });

  it.each([
    ['DEVDIGEST_REQUEST_TIMEOUT_MS', '999'],
    ['DEVDIGEST_REQUEST_TIMEOUT_MS', '120001'],
    ['DEVDIGEST_RUN_TIMEOUT_MS', '9999'],
    ['DEVDIGEST_RUN_TIMEOUT_MS', '600001'],
    ['DEVDIGEST_POLL_INTERVAL_MS', '1999'],
    ['DEVDIGEST_POLL_INTERVAL_MS', '60001'],
    ['DEVDIGEST_POLL_INTERVAL_MS', '1.5'],
    ['DEVDIGEST_POLL_INTERVAL_MS', 'abc'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(key);
  });
});
