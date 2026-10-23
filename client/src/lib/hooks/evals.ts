/* hooks/evals.ts — React Query hooks for the L06 agent eval pipeline:
   eval cases (from decided findings), eval runs (start, history, detail) and
   the two-run comparison. Spec: specs/eval-pipeline.md §6.2. */
"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  AgentEvalCase,
  AgentEvalRun,
  AgentEvalRunDetail,
  CreateEvalCaseFromFinding,
  EvalRunComparison,
  MultiAgentRun,
  ReviewRecord,
} from "@devdigest/shared";

/** Poll interval while an eval run is `running` (spec §9: the client polls, no SSE). */
export const EVAL_RUN_POLL_MS = 2000;

export const evalKeys = {
  cases: (agentId: string) => ["agent-eval-cases", agentId] as const,
  runs: (agentId: string) => ["agent-eval-runs", agentId] as const,
  run: (runId: string) => ["eval-run", runId] as const,
  compare: (baseId: string, headId: string) => ["eval-compare", baseId, headId] as const,
};

/** Mutation key of "turn a finding into an eval case". */
export const CREATE_EVAL_CASE_KEY = ["eval-case-create"] as const;

// ---- eval cases -----------------------------------------------------------------

export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId ?? ""),
    queryFn: () => api.get<AgentEvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/** Set one finding's `eval_case_id` in a cached reviews list (pure). */
export function patchEvalCaseId(
  reviews: ReviewRecord[] | undefined,
  findingId: string,
  evalCaseId: string,
): ReviewRecord[] | undefined {
  if (!reviews) return reviews;
  return reviews.map((r) =>
    r.findings.some((f) => f.id === findingId)
      ? { ...r, findings: r.findings.map((f) => (f.id === findingId ? { ...f, eval_case_id: evalCaseId } : f)) }
      : r,
  );
}

/** The id of the case that already exists, from a 409 `eval_case_exists` (else null). */
export function existingEvalCaseId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== "eval_case_exists") return null;
  const id = (err.details as { eval_case_id?: unknown } | undefined)?.eval_case_id;
  return typeof id === "string" ? id : null;
}

/** Set one finding's `eval_case_id` in a cached multi-agent run (pure; L07). */
export function patchMultiAgentEvalCaseId(
  state: { multi_run: MultiAgentRun | null } | undefined,
  findingId: string,
  evalCaseId: string,
): { multi_run: MultiAgentRun | null } | undefined {
  const run = state?.multi_run;
  if (!run || !run.columns.some((c) => c.findings.some((f) => f.id === findingId))) return state;
  return {
    ...state,
    multi_run: {
      ...run,
      columns: run.columns.map((c) =>
        c.findings.some((f) => f.id === findingId)
          ? { ...c, findings: c.findings.map((f) => (f.id === findingId ? { ...f, eval_case_id: evalCaseId } : f)) }
          : c,
      ),
    },
  };
}

function markFindingInEvalSet(qc: QueryClient, findingId: string, evalCaseId: string) {
  // Every PR's cached reviews list ("reviews", prId) — the card, accordion and inline
  // diff cards all read it, so "In eval set" shows at once without a reload.
  qc.setQueriesData<ReviewRecord[]>({ queryKey: ["reviews"] }, (old) => patchEvalCaseId(old, findingId, evalCaseId));
  // L07: the Multi-Agent Review results read the same finding from ("multi-agent", prId).
  // Patched in place (no refetch: the PR page header also holds that query).
  qc.setQueriesData<{ multi_run: MultiAgentRun | null }>({ queryKey: ["multi-agent"] }, (old) =>
    patchMultiAgentEvalCaseId(old, findingId, evalCaseId),
  );
}

export interface CreateEvalCaseVars {
  findingId: string;
  body: CreateEvalCaseFromFinding;
}

/** `POST /findings/:id/eval-case`. The label is derived on the server from the decision. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: CREATE_EVAL_CASE_KEY,
    mutationFn: ({ findingId, body }: CreateEvalCaseVars) =>
      api.post<AgentEvalCase>(`/findings/${findingId}/eval-case`, body),
    onSuccess: (created, { findingId }) => {
      markFindingInEvalSet(qc, findingId, created.id);
      qc.invalidateQueries({ queryKey: evalKeys.cases(created.agent_id) });
      qc.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (err, { findingId }) => {
      // Already in the eval set (e.g. created in another tab): reflect it, don't retry.
      const existing = existingEvalCaseId(err);
      if (existing) {
        markFindingInEvalSet(qc, findingId, existing);
        qc.invalidateQueries({ queryKey: ["reviews"] });
      }
    },
  });
}

// ---- eval runs ------------------------------------------------------------------

const anyRunning = (runs: AgentEvalRun[] | undefined) => !!runs?.some((r) => r.status === "running");

/** Run history of an agent, newest first; polls while a run is `running`. */
export function useAgentEvalRuns(agentId: string | null | undefined, limit?: number) {
  return useQuery({
    queryKey: [...evalKeys.runs(agentId ?? ""), limit ?? null],
    queryFn: () => api.get<AgentEvalRun[]>(`/agents/${agentId}/eval-runs${limit ? `?limit=${limit}` : ""}`),
    enabled: !!agentId,
    refetchInterval: (q) => (anyRunning(q.state.data) ? EVAL_RUN_POLL_MS : false),
  });
}

/** One run with its per-case results; polls while it is `running`. */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId ?? ""),
    queryFn: () => api.get<AgentEvalRunDetail>(`/eval-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? EVAL_RUN_POLL_MS : false),
  });
}

/** `POST /agents/:id/eval-runs` — starts a PAID run (the caller confirms first). */
export function useStartEvalRun(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["eval-run-start", agentId],
    mutationFn: () => api.post<AgentEvalRun>(`/agents/${agentId}/eval-runs`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
    },
  });
}

/** Two done runs of one agent (base = older, head = newer). */
export function useEvalCompare(baseId: string | null | undefined, headId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(baseId ?? "", headId ?? ""),
    queryFn: () => api.get<EvalRunComparison>(`/eval-runs/compare?base=${baseId}&head=${headId}`),
    enabled: !!baseId && !!headId,
  });
}
