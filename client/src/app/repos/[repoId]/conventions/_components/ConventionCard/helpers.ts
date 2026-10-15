import type { ConventionCandidate, ConventionsState } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

/** `src/users.ts:12`, `src/users.ts`, or null when the candidate has no evidence path. */
export function evidenceLocation(c: Pick<ConventionCandidate, "evidence_path" | "evidence_line">): string | null {
  if (!c.evidence_path) return null;
  return c.evidence_line ? `${c.evidence_path}:${c.evidence_line}` : c.evidence_path;
}

/** GitHub link to the evidence line at the commit the files were sampled from; null without a path or source. */
export function evidenceUrl(
  c: Pick<ConventionCandidate, "evidence_path" | "evidence_line">,
  source: ConventionsState["source"] | null | undefined,
): string | null {
  if (!c.evidence_path || !source) return null;
  return githubBlobUrl(source.repo_full_name, source.ref, c.evidence_path, c.evidence_line ?? undefined);
}

/** 0.873 → "87%"; unknown → "—". */
export function percent(confidence: number | null): string {
  return confidence == null ? "—" : `${Math.round(confidence * 100)}%`;
}
