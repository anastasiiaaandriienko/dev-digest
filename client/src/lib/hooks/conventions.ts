/* hooks/conventions.ts — React Query hooks for the Conventions Extractor
   (HW2 #38–#52): repo state (latest scan + candidates, polled while a scan
   runs), start a scan, Accept / Reject / Edit a candidate, the repo-conventions
   skill draft and its creation. Keys: ["conventions", repoId],
   ["conventions-skill-draft", repoId]. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConventionCandidate,
  ConventionScan,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionSkillResult,
  ConventionsState,
  ConventionUpdate,
} from "@devdigest/shared";
import { api } from "../api";
import { SKILLS_KEY } from "./skills";
import { agentSkillsKey } from "./agents";

export const conventionsKey = (repoId: string) => ["conventions", repoId] as const;
export const conventionSkillDraftKey = (repoId: string) => ["conventions-skill-draft", repoId] as const;

/** How often the page re-reads the state while a scan is running. */
export const SCAN_POLL_MS = 1500;

/** Latest scan + candidates (pending and accepted; rejected stay hidden). Polls while a scan runs. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionsKey(repoId ?? ""),
    queryFn: () => api.get<ConventionsState>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) => (query.state.data?.scan?.status === "running" ? SCAN_POLL_MS : false),
  });
}

/** POST …/conventions/extract — `rescan: false` = "Run Scan", `true` = "ReScan". */
export function useStartConventionScan(repoId: string) {
  const qc = useQueryClient();
  const key = conventionsKey(repoId);
  return useMutation({
    mutationFn: (rescan: boolean) => api.post<ConventionScan>(`/repos/${repoId}/conventions/extract`, { rescan }),
    onSuccess: (scan) => {
      // Show "Scanning…" at once (this also starts the polling).
      qc.setQueryData<ConventionsState>(key, (old) => (old ? { ...old, scan } : old));
      return qc.invalidateQueries({ queryKey: key });
    },
  });
}

/** The state after one candidate changed: a rejected one leaves the list, counts follow. */
export function applyCandidate(state: ConventionsState, updated: ConventionCandidate): ConventionsState {
  const before = state.candidates.find((c) => c.id === updated.id);
  const counts = { ...state.counts };
  if (before && before.status !== updated.status) {
    counts[before.status] = Math.max(0, counts[before.status] - 1);
    counts[updated.status] += 1;
  }
  const candidates =
    updated.status === "rejected"
      ? state.candidates.filter((c) => c.id !== updated.id)
      : state.candidates.map((c) => (c.id === updated.id ? updated : c));
  return { ...state, candidates, counts };
}

export interface UpdateConventionInput {
  id: string;
  patch: ConventionUpdate;
}

/**
 * PATCH /conventions/:id — Accept / Reject / back to pending / inline edit.
 * Optimistic (a rejected card disappears at once); rolled back on error (the
 * global MutationCache onError shows the toast). The skill draft is refreshed.
 */
export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  const key = conventionsKey(repoId);
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) => api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsState>(key);
      const current = previous?.candidates.find((c) => c.id === id);
      if (previous && current) {
        const next: ConventionCandidate = {
          ...current,
          ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
          ...(patch.category !== undefined ? { category: patch.category } : {}),
          ...(patch.status !== undefined ? { status: patch.status, accepted: patch.status === "accepted" } : {}),
        };
        qc.setQueryData(key, applyCandidate(previous, next));
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (updated) => {
      qc.setQueryData<ConventionsState>(key, (old) => (old ? applyCandidate(old, updated) : old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: conventionSkillDraftKey(repoId) }),
  });
}

/** GET …/conventions/skill-draft — only fetched while the Create skill modal is open. */
export function useConventionSkillDraft(repoId: string, enabled: boolean) {
  return useQuery({
    queryKey: conventionSkillDraftKey(repoId),
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: enabled && !!repoId,
    staleTime: 0,
    retry: false,
  });
}

/**
 * POST …/conventions/skill — create the reviewed draft (optionally attached to
 * an agent). Refreshes the Skills list (the new skill shows on /skills), the
 * agents list and the attached agent's skills.
 */
export function useCreateConventionSkill(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConventionSkillCreate) => api.post<ConventionSkillResult>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: (result) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: SKILLS_KEY }),
        qc.invalidateQueries({ queryKey: ["agents"] }),
        result.attached_agent_id ? qc.invalidateQueries({ queryKey: agentSkillsKey(result.attached_agent_id) }) : undefined,
      ]),
  });
}
