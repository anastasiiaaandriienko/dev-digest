import type { CiInstallationView, CiTarget } from "@devdigest/shared";

/** What the export wizard (B11–B12) is opened for: a new repository, or updating one installation. */
export type CiWizardRequest = { mode: "add" } | { mode: "update"; repo: string; target: CiTarget };

/** Renders the export wizard for a request; `close` discards it (AC-CI-18). */
export type RenderCiWizard = (request: CiWizardRequest, close: () => void) => React.ReactNode;

/** Installations whose status is `active` (badge "Active in N repos", AC-CI-61). */
export function activeCount(installations: readonly CiInstallationView[]): number {
  return installations.filter((i) => i.status === "active").length;
}

/** The repo's copy of the agent is older than the agent (AC-CI-66). */
export function isOutdated(installation: CiInstallationView, agentVersion: number): boolean {
  return installation.agent_version != null && installation.agent_version !== agentVersion;
}

/** CI Runs filtered by agent and repo (AC-CI-67, 82). */
export function ciRunsHref(agentId: string, repo: string): string {
  const qs = new URLSearchParams({ agent_id: agentId, repo });
  return `/ci-runs?${qs.toString()}`;
}

/** Badge colours per installation status. */
export const STATUS_TONE: Record<CiInstallationView["status"], { color: string; bg: string }> = {
  pending: { color: "var(--warn)", bg: "var(--warn-bg)" },
  active: { color: "var(--ok)", bg: "var(--ok-bg)" },
  error: { color: "var(--crit)", bg: "var(--crit-bg)" },
};
