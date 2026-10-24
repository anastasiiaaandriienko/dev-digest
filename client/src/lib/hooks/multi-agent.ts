/* hooks/multi-agent.ts — React Query hooks for the L07 Multi-Agent Review
   (GET /pulls/:id/multi-agent, GET /multi-agent/estimates, POST /pulls/:id/review
   with agentIds). Imported directly ("@/lib/hooks/multi-agent"), not via the
   hooks barrel. The single-agent / run-all hook stays useRunReview (reviews.ts). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { MULTI_AGENT_POLL_MS, hasRunningColumn } from "../multi-agent";
import type { AgentEstimate, MultiAgentRun, MultiAgentStartResponse } from "@devdigest/shared";

/** Latest multi-run of a PR. Also invalidated by finding actions and run deletes (reviews.ts). */
export const multiAgentKey = (prId: string | null | undefined) => ["multi-agent", prId] as const;
/** Workspace-wide per-agent estimates (Configure run). */
export const AGENT_ESTIMATES_KEY = ["multi-agent-estimates"] as const;

export interface MultiAgentRunState {
  multi_run: MultiAgentRun | null;
}

/**
 * The PR's latest multi-run, or `{ multi_run: null }` when it has none (AC-MAR-10).
 * Polls while any column is still running, so the columns settle on their own;
 * live progress itself comes from useRunEvents (SSE).
 */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKey(prId),
    queryFn: () => api.get<MultiAgentRunState>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    refetchInterval: (query) =>
      hasRunningColumn(query.state.data?.multi_run?.columns) ? MULTI_AGENT_POLL_MS : false,
  });
}

/** Per-agent average duration/cost of the last 10 done local runs (AC-MAR-19). */
export function useAgentEstimates() {
  return useQuery({
    queryKey: AGENT_ESTIMATES_KEY,
    queryFn: () => api.get<AgentEstimate[]>("/multi-agent/estimates"),
  });
}

export interface StartMultiAgentRunInput {
  prId: string;
  /** Selected agents in pick order (= column order). The server de-duplicates. */
  agentIds: string[];
}

/**
 * Start a multi-agent run (POST /pulls/:id/review { agentIds }). On success the
 * PR's multi-run, in-flight runs, run history and reviews are refetched. A
 * failure is toasted by the global MutationCache handler; callers keep their
 * selection (AC-MAR-26).
 */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: StartMultiAgentRunInput) =>
      api.post<MultiAgentStartResponse>(`/pulls/${prId}/review`, { agentIds }),
    onSuccess: (_data, { prId }) => {
      qc.invalidateQueries({ queryKey: multiAgentKey(prId) });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}
