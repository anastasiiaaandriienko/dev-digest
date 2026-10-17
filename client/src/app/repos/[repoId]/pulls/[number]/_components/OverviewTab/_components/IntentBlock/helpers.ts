import type { IntentModelInfo, PrIntentMeta } from "@devdigest/shared";
import { SHORT_SHA_LENGTH } from "./constants";

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, SHORT_SHA_LENGTH) : null;
}

export function modelLabel(m: { provider: string | null; model: string | null } | null | undefined): string | null {
  if (!m || !m.model) return null;
  return m.provider ? `${m.provider}/${m.model}` : m.model;
}

/**
 * Single predicate for "Intent has a usable model": drives BOTH the
 * ModelUnavailable message and the disabled state of Run / Recalculate.
 */
export function modelAvailable<M extends { provider: string | null; model: string | null }>(
  m: M | null | undefined,
): m is M & { model: string } {
  return modelLabel(m) != null;
}

/** Message key of the model source ("from Settings" / "fallback from Onboarding"). */
export function sourceKey(source: IntentModelInfo["source"]): "sourceOverride" | "sourceFallback" {
  return source === "override" ? "sourceOverride" : "sourceFallback";
}

/** Legacy rows (no prompt_version) have no trustworthy generation time → hide it. */
export function generatedTime(meta: PrIntentMeta): string | null {
  if (meta.prompt_version == null) return null;
  const d = new Date(meta.generated_at);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}
