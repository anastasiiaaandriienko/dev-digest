import { ApiError, ToolInputError, sanitizeMessage } from './errors.js';

/**
 * Helpers that build MCP tool results: a compact text block for the model plus
 * `structuredContent` that matches the tool's outputSchema. Errors never carry
 * stack traces or raw upstream bodies.
 */

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

/** A safe, short error result. Unknown errors are not echoed back verbatim. */
export function fail(err: unknown): ToolResult {
  const message =
    err instanceof ApiError || err instanceof ToolInputError
      ? err.message
      : err instanceof Error
        ? `Unexpected error: ${sanitizeMessage(err.message)}`
        : 'Unexpected error';
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Bound a free-text field (rationales, descriptions) so tool output stays small. */
export function clip(text: string | null | undefined, max: number): string | null {
  if (text == null) return null;
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
