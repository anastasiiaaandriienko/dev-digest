/* hooks/ci.ts — React Query hooks for Export to CI + CI Runs (L07, specs/export-to-ci.md §6.1):
   preview / export / zip of an agent's CI files, installations (per agent, per repo),
   ingested CI runs and the GitHub Actions sync. */
"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallationView,
  CiPreview,
  CiRun,
  CiSyncInput,
  CiSyncResult,
} from "@devdigest/shared";

export interface CiRunsFilters {
  agentId?: string;
  repo?: string;
}

/** Every CI key starts with "ci", so one prefix refreshes all CI data. */
export const ciKeys = {
  all: ["ci"] as const,
  installations: ["ci", "installations"] as const,
  agentInstallations: (agentId: string) => ["ci", "installations", "agent", agentId] as const,
  repoInstallations: (repo: string) => ["ci", "installations", "repo", repo] as const,
  runs: ["ci", "runs"] as const,
  runsFor: (f: CiRunsFilters) => ["ci", "runs", f.agentId ?? null, f.repo ?? null] as const,
};

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

// ---- installations ------------------------------------------------------------------

/** GET /agents/:id/ci/installations — the agent's CI tab. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.agentInstallations(agentId ?? ""),
    queryFn: () => api.get<CiInstallationView[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

/** GET /ci/installations?repo= — who already runs on a repo (wizard occupancy, AC-CI-05). */
export function useRepoCiInstallations(repo: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.repoInstallations(repo ?? ""),
    queryFn: () => api.get<CiInstallationView[]>(`/ci/installations?repo=${encodeURIComponent(repo!)}`),
    enabled: !!repo && REPO_RE.test(repo),
  });
}

// ---- runs -------------------------------------------------------------------------------

/** GET /ci/runs?agent_id=&repo= — newest 50 ingested runs (AC-CI-51, 82). */
export function useCiRuns(filters: CiRunsFilters = {}) {
  const qs = new URLSearchParams();
  if (filters.agentId) qs.set("agent_id", filters.agentId);
  if (filters.repo) qs.set("repo", filters.repo);
  const query = qs.toString();
  return useQuery({
    queryKey: ciKeys.runsFor(filters),
    queryFn: () => api.get<CiRun[]>(`/ci/runs${query ? `?${query}` : ""}`),
  });
}

function refreshAfterSync(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ciKeys.runs });
  qc.invalidateQueries({ queryKey: ciKeys.installations });
}

/** POST /ci/runs/sync — a manual Sync (one installation or all; AC-CI-57). Errors toast. */
export function useCiSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["ci", "sync"],
    mutationFn: (input: CiSyncInput) => api.post<CiSyncResult>("/ci/runs/sync", input),
    onSuccess: () => refreshAfterSync(qc),
  });
}

/**
 * An automatic sync once per mount of a CI page (AC-CI-49): the server only syncs
 * installations not synced for 10 minutes. Silent — a failure shows no toast.
 */
export function useCiAutoSync(enabled = true) {
  const qc = useQueryClient();
  const started = React.useRef(false);
  const mutation = useMutation({
    mutationKey: ["ci", "sync", "auto"],
    mutationFn: () => api.post<CiSyncResult>("/ci/runs/sync", { mode: "auto" } satisfies CiSyncInput),
    onSuccess: (res) => {
      if (res.ingested > 0 || res.errors.length > 0 || res.skipped.length > 0) refreshAfterSync(qc);
    },
    meta: { silent: true },
  });
  const { mutate } = mutation;
  React.useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    mutate();
  }, [enabled, mutate]);
  return mutation;
}

// ---- preview / export -------------------------------------------------------------------

export interface CiExportVars {
  agentId: string;
  body: CiExportInputBody;
}

/** POST /agents/:id/ci/preview — the files an export would write (AC-CI-06). Errors shown inline. */
export function useCiPreview() {
  return useMutation({
    mutationKey: ["ci", "preview"],
    mutationFn: ({ agentId, body }: CiExportVars) => api.post<CiPreview>(`/agents/${agentId}/ci/preview`, body),
    meta: { silent: true },
  });
}

/** POST /agents/:id/export-ci — open/update the PR (AC-CI-15, 16). Errors shown inline on Install. */
export function useExportCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["ci", "export"],
    mutationFn: ({ agentId, body }: CiExportVars) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, { ...body, action: "open_pr" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.installations }),
    meta: { silent: true },
  });
}

/** kebab-case like the server's slugify, for the zip name (the browser cannot read content-disposition). */
export function ciZipFilename(agentName: string): string {
  const slug = agentName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `devdigest-ci-${slug || "agent"}.zip`;
}

/** Hand a blob to the browser as a file download; the object URL is revoked right after. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface CiZipVars extends CiExportVars {
  agentName: string;
}

/** POST /agents/:id/export-ci/zip — download the same files as a zip (AC-CI-17, 39). */
export function useExportCiZip() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["ci", "export", "zip"],
    mutationFn: async ({ agentId, agentName, body }: CiZipVars) => {
      const blob = await api.postBlob(`/agents/${agentId}/export-ci/zip`, body);
      const filename = ciZipFilename(agentName);
      saveBlob(blob, filename);
      return { filename, size: blob.size };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.installations }),
    meta: { silent: true },
  });
}
