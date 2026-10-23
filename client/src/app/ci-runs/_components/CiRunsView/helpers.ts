import type { CiRun } from "@devdigest/shared";
import type { CiRunsFilters } from "@/lib/hooks/ci";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** `?agent_id=&repo=` (AC-CI-82); malformed values are ignored, never sent. */
export function readFilters(search: Pick<URLSearchParams, "get">): CiRunsFilters {
  const agentId = search.get("agent_id") ?? "";
  const repo = search.get("repo") ?? "";
  return {
    ...(UUID_RE.test(agentId) ? { agentId } : {}),
    ...(REPO_RE.test(repo) ? { repo } : {}),
  };
}

/** The page URL for a filter set — filters live only in the query. */
export function filtersHref(filters: CiRunsFilters): string {
  const qs = new URLSearchParams();
  if (filters.agentId) qs.set("agent_id", filters.agentId);
  if (filters.repo) qs.set("repo", filters.repo);
  const query = qs.toString();
  return query ? `/ci-runs?${query}` : "/ci-runs";
}

/** The Actions job link only when the API gave a GitHub https URL; never built from other fields. */
export function safeJobUrl(url: string | null | undefined): string | null {
  return url && /^https:\/\/github\.com\//.test(url) ? url : null;
}

export function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/** "4.2 s" under a minute, else "1m 05s"; null when unknown. */
export function fmtDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** Badge colours per verdict (A7: gate triggered → blocked, artifact → passed, none → failed). */
export const VERDICT_TONE: Record<NonNullable<CiRun["verdict"]>, { color: string; bg: string }> = {
  blocked: { color: "var(--crit)", bg: "var(--crit-bg)" },
  passed: { color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { color: "var(--warn)", bg: "var(--warn-bg)" },
};
