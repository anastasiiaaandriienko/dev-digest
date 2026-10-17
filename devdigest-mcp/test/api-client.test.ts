import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiClient } from '../src/api-client.js';
import { ApiError, sanitizeMessage } from '../src/errors.js';
import { jsonResponse, makeFetch } from './helpers.js';

const Schema = z.object({ ok: z.boolean() });

async function catchApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

describe('ApiClient', () => {
  it('GET builds the URL, sends accept only, and validates JSON', async () => {
    const { fetch, calls } = makeFetch(() => ({ body: { ok: true, extra: 1 } }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const out = await api.get('/agents?x=1', Schema);
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'http://api.test/agents?x=1', body: undefined });
    expect(calls[0]!.headers).toEqual({ accept: 'application/json' });
  });

  it('POST sends JSON body with content-type', async () => {
    const { fetch, calls } = makeFetch(() => ({ body: { ok: true } }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    await api.post('/pulls/1/review', { agentId: 'a' }, Schema);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://api.test/pulls/1/review', body: { agentId: 'a' } });
    expect(calls[0]!.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
  });

  it('maps a server error envelope to ApiError http with status and code', async () => {
    const { fetch } = makeFetch(() => ({ status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } } }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err).toMatchObject({ kind: 'http', status: 429, code: 'RATE_LIMITED' });
    expect(err.message).toContain('429 RATE_LIMITED');
    expect(err.message).toContain('slow down');
  });

  it('sanitizes secrets in the server error message', async () => {
    const { fetch } = makeFetch(() => ({
      status: 500,
      body: { error: { code: 'X', message: 'bad ghp_abcdef123456 and Bearer abc.def' } },
    }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err.message).not.toContain('ghp_abcdef123456');
    expect(err.message).not.toContain('abc.def');
  });

  it('handles non-JSON error bodies without leaking them', async () => {
    const { fetch } = makeFetch(() => ({ status: 502, text: '<html>Bad gateway at secret-host</html>' }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err).toMatchObject({ kind: 'http', status: 502, code: undefined });
    expect(err.message).toContain('HTTP 502');
    expect(err.message).not.toContain('secret-host');
  });

  it('handles an empty error body', async () => {
    const { fetch } = makeFetch(() => ({ status: 404 }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err).toMatchObject({ kind: 'http', status: 404 });
  });

  it('times out when fetch honours the AbortSignal', async () => {
    const fetch = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init!.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 20, fetch });
    const err = await catchApiError(api.get('/slow', Schema));
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('20 ms');
  });

  it('the timeout also covers a stalled response body', async () => {
    const fetch = async (_u: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // Headers arrive at once; the body never completes until the request is aborted.
          init!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 20, fetch });
    const err = await catchApiError(api.get('/stalled-body', Schema));
    expect(err.kind).toBe('timeout');
  });

  it('maps a fetch rejection to network with the cause code', async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    };
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err.kind).toBe('network');
    expect(err.message).toContain('ECONNREFUSED');
    expect(err.message).toContain('http://api.test');
  });

  it('maps a fetch rejection without cause to network', async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error('boom');
    };
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    const err = await catchApiError(api.get('/x', Schema));
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain('boom');
  });

  it('reports invalid_response when the shape does not match', async () => {
    const { fetch } = makeFetch(() => ({ body: { ok: 'yes' } }));
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    expect((await catchApiError(api.get('/x', Schema))).kind).toBe('invalid_response');
  });

  it('reports invalid_response for a 200 with a non-JSON body', async () => {
    const fetch = async () => jsonResponse({ text: 'not json' });
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetch });
    expect((await catchApiError(api.get('/x', Schema))).kind).toBe('invalid_response');
  });

  it('uses globalThis.fetch by default (blocked in tests)', async () => {
    const api = new ApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000 });
    await expect(api.get('/x', Schema)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('sanitizeMessage', () => {
  it('redacts GitHub tokens', () => {
    const out = sanitizeMessage('a ghp_AbC123 b github_pat_11AAA_bbb c gho_xyz');
    expect(out).toBe('a [redacted] b [redacted] c [redacted]');
  });
  it('redacts sk- keys', () => {
    expect(sanitizeMessage('key sk-abcdefgh1234')).toBe('key [redacted]');
  });
  it('redacts Bearer tokens case-insensitively', () => {
    const out = sanitizeMessage('Authorization: bearer abc.DEF-123');
    expect(out).toContain('Bearer [redacted]');
    expect(out).not.toContain('abc.DEF');
  });
  it('redacts URL credentials', () => {
    const out = sanitizeMessage('clone https://user:pa55@github.com/x/y failed');
    expect(out).not.toContain('pa55');
    expect(out).not.toContain('user:');
  });
  it('collapses whitespace and bounds length to 300', () => {
    const out = sanitizeMessage(`  a\n\n b  ${'x'.repeat(1000)}`);
    expect(out.startsWith('a b x')).toBe(true);
    expect(out.length).toBe(300);
  });
  it('leaves harmless text untouched', () => {
    expect(sanitizeMessage('plain message')).toBe('plain message');
  });
});
