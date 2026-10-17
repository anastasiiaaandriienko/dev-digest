/**
 * Error type and message sanitizing shared by the HTTP client (which raises
 * ApiError) and the tool layer (which turns it into a tool error). Pure: no I/O.
 */

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid_response';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A tool argument problem the caller can fix (missing / conflicting identifiers,
 * an ambiguous or unknown PR). Its message is shown to the model as is.
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const MAX_MESSAGE_CHARS = 300;

/** Redact anything that looks like a credential and bound the length. */
export function sanitizeMessage(text: string): string {
  return text
    .replace(/\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@/gi, '[redacted]@')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}
