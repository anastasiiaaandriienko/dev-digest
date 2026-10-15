import type { ConventionCandidate } from "@devdigest/shared";

/** `src/users.ts:12`, `src/users.ts`, or null when the candidate has no evidence path. */
export function evidenceLocation(c: Pick<ConventionCandidate, "evidence_path" | "evidence_line">): string | null {
  if (!c.evidence_path) return null;
  return c.evidence_line ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path;
}

/** 0.873 → "87%"; unknown → "—". */
export function percent(confidence: number | null): string {
  return confidence == null ? "—" : `${Math.round(confidence * 100)}%`;
}
