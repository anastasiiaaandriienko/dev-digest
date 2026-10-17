/* hooks/blast.ts — HW-04 Blast Radius.
   GET /pulls/:id/blast is a pure local read over stored pr_files + the repo-intel
   index (no GitHub sync, no LLM). This module only ever GETs that one endpoint. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

export const blastKey = (prId: string | null | undefined) => ["pr-blast", prId] as const;

/**
 * Read the PR's blast radius. `enabled` lets the Overview wait until the PR detail
 * has settled (`usePullSettled(prId, blastKey)`), so the read does not race the
 * pr_files resync that `GET /pulls/:id` performs.
 */
export function useBlastRadius(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: blastKey(prId),
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId && enabled,
    refetchOnWindowFocus: false,
  });
}
