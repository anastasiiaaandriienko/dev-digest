/* hooks/brief.ts — PR Why + Risk Brief.
   GET /pulls/:id/brief is a pure local read (no LLM). POST runs the (paid) LLM
   and is therefore never retried automatically and never fired from a query. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefState } from "@devdigest/shared";

export const briefKey = (prId: string | null | undefined) => ["pr-brief", prId] as const;

/**
 * Read the stored brief + freshness. GET only. `enabled` lets the card wait for
 * `usePullSettled(prId, briefKey)` so the read does not race the pr_files resync.
 */
export function usePrBrief(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: briefKey(prId),
    queryFn: () => api.get<PrBriefState>(`/pulls/${prId}/brief`),
    enabled: !!prId && enabled,
    refetchOnWindowFocus: false,
  });
}

/** Explicit Generate (force=false) / Refresh (force=true). Never auto-retried. */
export function useRunBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["pr-brief-run", prId],
    mutationFn: ({ force }: { force: boolean }) =>
      api.post<PrBriefState>(`/pulls/${prId}/brief`, { force }),
    retry: 0, // a paid LLM call must never be retried automatically
    meta: { silent: true }, // BriefCard renders its own inline error → no global toast
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: briefKey(prId) });
    },
  });
}
