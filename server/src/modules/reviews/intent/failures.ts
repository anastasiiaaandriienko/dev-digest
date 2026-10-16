import { AppError, ExternalServiceError } from '../../../platform/errors.js';
import { TimeoutError } from '../../../platform/resilience.js';
import {
  INTENT_INPUTS_INCOMPLETE_MESSAGE,
  INTENT_INVALID_OUTPUT_MESSAGE,
  INTENT_PROVIDER_AUTH_MESSAGE,
  INTENT_PROVIDER_ERROR_MESSAGE,
  INTENT_PROVIDER_RATE_LIMIT_MESSAGE,
  INTENT_SAVE_FAILED_MESSAGE,
  INTENT_TIMEOUT_MESSAGE,
} from './constants.js';

/**
 * Safe error mapping for the intent flow. Whatever a provider / SDK throws, the
 * HTTP response only ever carries one of the fixed messages below; the raw
 * message, response body and headers are never forwarded or logged.
 */

/** 504: the caller's wait elapsed; the flight may still complete and save. */
export class IntentTimeoutError extends AppError {
  constructor() {
    super('intent_timeout', INTENT_TIMEOUT_MESSAGE, 504);
  }
}

/** 409: the PR's file list is not stored locally, so the intent input is incomplete. */
export class IntentInputsIncompleteError extends AppError {
  constructor() {
    super('intent_inputs_incomplete', INTENT_INPUTS_INCOMPLETE_MESSAGE, 409);
  }
}

/** 500: the model answered but the result could not be persisted. */
export class IntentSaveFailedError extends AppError {
  constructor() {
    super('intent_save_failed', INTENT_SAVE_FAILED_MESSAGE, 500);
  }
}

/** The model produced an answer that does not match the intent schema. */
export class IntentInvalidOutputError extends Error {
  constructor() {
    super('invalid intent output');
    this.name = 'IntentInvalidOutputError';
  }
}

/** Fields that are safe to log (no message, body, headers or secrets). */
export interface SafeFailureFields {
  errorName: string;
  httpStatus?: number;
  providerCode?: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

function safeToken(v: unknown): string | undefined {
  return typeof v === 'string' && SAFE_TOKEN.test(v) ? v : undefined;
}

function pick(err: unknown): { name: string; status?: number; code?: string; message: string; isApp: boolean } {
  if (typeof err !== 'object' || err === null) return { name: 'NonError', message: '', isApp: false };
  const e = err as { name?: unknown; status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; response?: { status?: unknown } };
  const isApp = err instanceof AppError;
  // AppError.statusCode is OUR status (e.g. 502), not the provider's: only SDK-style fields count.
  const rawStatus = e.status ?? (isApp ? undefined : e.statusCode) ?? e.response?.status;
  return {
    name: safeToken(e.name) ?? 'Error',
    status: typeof rawStatus === 'number' ? rawStatus : undefined,
    code: safeToken(e.code),
    message: typeof e.message === 'string' ? e.message : '',
    isApp,
  };
}

/**
 * Map any failure of the model call / flight to a safe AppError plus the fields
 * allowed in logs. `message` is read only to classify, never copied out.
 */
export function mapIntentFailure(err: unknown): { error: AppError; fields: SafeFailureFields } {
  const p = pick(err);
  const fields: SafeFailureFields = { errorName: p.name };
  if (p.status !== undefined) fields.httpStatus = p.status;
  if (p.code !== undefined) fields.providerCode = p.code;

  // Our own intent errors (model unavailable, save failed, ...) already carry safe messages.
  if (err instanceof AppError && err.code.startsWith('intent_')) return { error: err, fields };

  if (err instanceof TimeoutError || /timeout/i.test(p.name) || p.code === 'ETIMEDOUT') {
    return { error: new IntentTimeoutError(), fields }; // a provider-side timeout reads the same to the user
  }
  if (p.status === 401 || p.status === 403) {
    return { error: new ExternalServiceError(INTENT_PROVIDER_AUTH_MESSAGE), fields };
  }
  if (p.status === 429) {
    return { error: new ExternalServiceError(INTENT_PROVIDER_RATE_LIMIT_MESSAGE), fields };
  }
  const invalid =
    err instanceof IntentInvalidOutputError ||
    p.name === 'ZodError' ||
    p.name === 'SyntaxError' ||
    (p.isApp && /structured output|schema validation|invalid json/i.test(p.message));
  if (invalid) return { error: new ExternalServiceError(INTENT_INVALID_OUTPUT_MESSAGE), fields };

  return { error: new ExternalServiceError(INTENT_PROVIDER_ERROR_MESSAGE), fields };
}
