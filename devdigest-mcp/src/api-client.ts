import type { z } from 'zod';
import { ApiError, sanitizeMessage } from './errors.js';

/**
 * Minimal HTTP client for the DevDigest API. Every request has a timeout; every
 * failure becomes an ApiError with a short, sanitized message (no stack traces,
 * no tokens, no raw bodies). Responses are validated with the given Zod schema.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetch?: FetchLike;
}

export class ApiClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    return this.request('GET', path, undefined, schema);
  }

  post<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    return this.request('POST', path, body, schema);
  }

  private async request<S extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.infer<S>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    let res: Response;
    let text: string;
    try {
      // The timeout covers the whole exchange: headers AND body.
      res = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
        method,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await res.text().catch((err: unknown) => {
        if (controller.signal.aborted) throw err;
        return '';
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ApiError('timeout', `DevDigest API did not respond within ${this.opts.timeoutMs} ms (${method} ${path})`);
      }
      const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
      throw new ApiError(
        'network',
        `DevDigest API is unreachable at ${this.opts.baseUrl}${typeof code === 'string' ? ` (${code})` : ''} — is the server running?`,
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!res.ok) {
      const envelope = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const code = typeof envelope?.code === 'string' ? envelope.code : undefined;
      const message = typeof envelope?.message === 'string' ? sanitizeMessage(envelope.message) : `HTTP ${res.status}`;
      throw new ApiError('http', `DevDigest API ${method} ${path} failed: ${res.status}${code ? ` ${code}` : ''} — ${message}`, res.status, code);
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError('invalid_response', `DevDigest API ${method} ${path} returned an unexpected response shape`);
    }
    return parsed.data;
  }
}
