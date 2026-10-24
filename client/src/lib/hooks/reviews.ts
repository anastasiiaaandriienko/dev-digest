/* hooks/reviews.ts — React Query + SSE hooks for the A2 reviewer.
   Run a review, stream RunEvents live, act on findings. */
"use client";

import React from "react";
import { useQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import { notify } from "../toast";
import type {
  FindingActionKind,
  PrReviewComment,
  ReviewRecord,
  ReviewRunResponse,
  RunEvent,
  RunSummary,
} from "@devdigest/shared";

// ---- Active (in-flight) runs — server-side source of truth ----
export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** In-flight runs for a PR, from the server (agent_runs where status='running').
   Survives reloads/devices; polls while anything is running so it self-clears. */
export function usePrActiveRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-active-runs", prId],
    queryFn: () => api.get<ActiveRun[]>(`/pulls/${prId}/runs/active`),
    enabled: !!prId,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 4000 : false),
  });
}

// ---- Full run history for a PR (every agent_runs row, any status) ----
/** All runs for a PR — done, failed (with error), cancelled, running. Survives
   reload (DB-backed). Polls while anything is running so it self-updates. */
export function usePrRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-runs", prId],
    queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false,
  });
}

// ---- Persisted reviews + findings for a PR ----
export function usePrReviews(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId],
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}

/** PR-list query key: one repo's list when known, every repo's list otherwise. */
function pullsKey(repoId: string | null | undefined) {
  return repoId ? ["pulls", repoId] : ["pulls"];
}

/** Delete one run from the PR's run history (+ its trace). */
export function useDeleteRun(prId: string | null | undefined, repoId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.del<{ ok: boolean }>(`/runs/${runId}`),
    // Deleting a run also deletes the review it produced (server-side), so drop
    // both the timeline and the Review Runs list from cache. The PR list's cost
    // total (L01) drops with it.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: pullsKey(repoId) });
      // L07: a deleted child run drops out of the multi-agent results (AC-MAR-57).
      qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
    },
  });
}

/** Ids of runs that were `running` in `prev` and are now settled in `next`. */
export function settledRunIds(
  prev: RunSummary[] | undefined,
  next: RunSummary[] | undefined,
): string[] {
  if (!prev || !next) return [];
  const wasRunning = new Set(prev.filter((r) => r.status === "running").map((r) => r.run_id));
  return next.filter((r) => wasRunning.has(r.run_id) && r.status !== "running").map((r) => r.run_id);
}

/**
 * L01 cost refresh. When a run in the PR's history leaves `running` — seen via
 * the SSE-driven `pr-runs` invalidation or via its 4 s poll — its cost has
 * just landed: refetch the PR list (cost total) and that run's trace (Cost
 * stat). The timeline itself is the `pr-runs` data that triggered this.
 */
export function useRefreshCostOnRunSettled(
  runs: RunSummary[] | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  const prev = React.useRef<RunSummary[] | undefined>(undefined);
  React.useEffect(() => {
    const settled = settledRunIds(prev.current, runs);
    prev.current = runs;
    if (settled.length === 0) return;
    qc.invalidateQueries({ queryKey: pullsKey(repoId) });
    for (const runId of settled) qc.invalidateQueries({ queryKey: ["run-trace", runId] });
  }, [runs, repoId, qc]);
}

/** Run ids present in `prev` and absent from `next`; [] while either side is unknown. */
export function finishedActiveRunIds(
  prev: ActiveRun[] | null | undefined,
  next: ActiveRun[] | undefined,
): string[] {
  if (!prev || !next) return [];
  const still = new Set(next.map((r) => r.run_id));
  return prev.map((r) => r.run_id).filter((id) => !still.has(id));
}

/**
 * Refresh findings when a review finishes, whatever tab is open (the SSE stream
 * only exists on the Findings tab). Completion = a run id that was in the
 * previous `usePrActiveRuns` data and is gone now. Nothing fires on first load
 * (no previous data) or while the query is loading (`undefined` resets the
 * baseline), and each finished run id triggers one invalidation round.
 */
export function useRefreshReviewsOnRunsSettled(
  activeRuns: ActiveRun[] | undefined,
  prId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  const prev = React.useRef<{ prId: string | null | undefined; runs: ActiveRun[] | undefined }>({
    prId,
    runs: undefined,
  });
  React.useEffect(() => {
    // A different PR starts with no baseline (its cached runs must not look like "finished").
    const base = prev.current.prId === prId ? prev.current.runs : undefined;
    const finished = finishedActiveRunIds(base, activeRuns);
    prev.current = { prId, runs: activeRuns };
    if (finished.length === 0) return;
    qc.invalidateQueries({ queryKey: ["reviews", prId] });
    qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
    qc.invalidateQueries({ queryKey: pullsKey(repoId) });
  }, [activeRuns, prId, repoId, qc]);
}

/** Request cancellation of an in-flight run (takes effect at the next step). */
export function useCancelRun() {
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/runs/${runId}/cancel`),
  });
}

/** Delete a whole review run (one agent's pass) + its findings. */
export function useDeleteReview(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.del<{ ok: boolean }>(`/reviews/${reviewId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reviews", prId] }),
  });
}

// ---- Inline review comments on the "Files changed" tab (proxied to GitHub) --
/** Existing GitHub PR review comments, fetched live. */
export function usePrComments(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-comments", prId],
    queryFn: () => api.get<PrReviewComment[]>(`/pulls/${prId}/comments`),
    enabled: !!prId,
  });
}

export interface CreateCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  in_reply_to?: number;
}

/** Post one inline comment (or reply) to GitHub; refreshes the thread list. */
export function useCreatePrComment(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<PrReviewComment>(`/pulls/${prId}/comments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-comments", prId] }),
  });
}

// ---- Run a review (all enabled agents or a specific agent) ----
export interface RunReviewInput {
  prId: string;
  agentId?: string;
  all?: boolean;
}

export function useRunReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentId, all }: RunReviewInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, {
        ...(agentId ? { agentId } : {}),
        ...(all ? { all } : {}),
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}

// ---- Finding actions (accept / reject = server "dismiss") ----

/** Mutation key of finding decisions; per-card status is read back by it. */
export const FINDING_ACTION_KEY = ["finding-action"] as const;

export interface FindingActionVars {
  findingId: string;
  action: FindingActionKind;
  reply?: string;
  prId?: string;
}

type DecisionFields = Pick<ReviewRecord["findings"][number], "accepted_at" | "dismissed_at">;

/** Set one finding's decision timestamps in a cached reviews list (pure). */
export function patchFinding(
  reviews: ReviewRecord[] | undefined,
  findingId: string,
  fields: DecisionFields,
): ReviewRecord[] | undefined {
  if (!reviews) return reviews;
  return reviews.map((r) =>
    r.findings.some((f) => f.id === findingId)
      ? { ...r, findings: r.findings.map((f) => (f.id === findingId ? { ...f, ...fields } : f)) }
      : r,
  );
}

/** The timestamps a decision leaves behind; accept and dismiss exclude each other (server-side too). */
export function decisionFields(action: FindingActionKind, at: string): DecisionFields | null {
  if (action === "accept") return { accepted_at: at, dismissed_at: null };
  if (action === "dismiss") return { accepted_at: null, dismissed_at: at };
  return null;
}

export function useFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: FINDING_ACTION_KEY,
    mutationFn: ({ findingId, action, reply }: FindingActionVars) =>
      api.post<{ finding: ReviewRecord["findings"][number]; memoryId?: string }>(
        `/findings/${findingId}/${action}`,
        reply ? { reply } : undefined,
      ),
    // Optimistic: the card, the accordion's blocker count, the PR-list popover
    // and the Trace drawer all read ["reviews", prId], so they update at once.
    onMutate: async ({ findingId, action, prId }) => {
      const fields = decisionFields(action, new Date().toISOString());
      if (!prId || !fields) return undefined;
      const key = ["reviews", prId];
      await qc.cancelQueries({ queryKey: key });
      const before = qc
        .getQueryData<ReviewRecord[]>(key)
        ?.flatMap((r) => r.findings)
        .find((f) => f.id === findingId);
      qc.setQueryData<ReviewRecord[]>(key, (old) => patchFinding(old, findingId, fields));
      return before ? { key, previous: { accepted_at: before.accepted_at, dismissed_at: before.dismissed_at } } : undefined;
    },
    // Roll back ONLY this finding (other in-flight decisions keep their state).
    // The global MutationCache onError already shows the error toast.
    onError: (_err, { findingId }, ctx) => {
      if (ctx) qc.setQueryData<ReviewRecord[]>(ctx.key, (old) => patchFinding(old, findingId, ctx.previous));
    },
    onSettled: (_d, _e, { prId }) => {
      if (prId) qc.invalidateQueries({ queryKey: ["reviews", prId] });
      // L07: the multi-agent results carry the same findings (AC-MAR-38).
      if (prId) qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
    },
  });
}

export type DecisionStatus = "pending" | "error" | "success";

/** Latest decision status per finding id, across every mounted panel. */
export function useFindingDecisionStatus(): Map<string, DecisionStatus> {
  const rows = useMutationState({
    filters: { mutationKey: FINDING_ACTION_KEY },
    select: (m) => ({
      id: (m.state.variables as FindingActionVars | undefined)?.findingId,
      status: m.state.status,
      at: m.state.submittedAt,
    }),
  });
  return React.useMemo(() => latestDecisionStatus(rows), [rows]);
}

/** Reduce mutation rows to the most recent status per finding (pure). */
export function latestDecisionStatus(
  rows: readonly { id?: string; status: string; at: number }[],
): Map<string, DecisionStatus> {
  const latest = new Map<string, { status: string; at: number }>();
  for (const r of rows) {
    if (!r.id) continue;
    const prev = latest.get(r.id);
    if (!prev || r.at >= prev.at) latest.set(r.id, { status: r.status, at: r.at });
  }
  const out = new Map<string, DecisionStatus>();
  for (const [id, { status }] of latest) {
    if (status === "pending" || status === "error" || status === "success") out.set(id, status);
  }
  return out;
}

/**
 * Subscribe to a run's SSE event stream. Returns the accumulated RunEvents and a
 * `running` flag (true until the stream closes). Live status for the
 * RunReviewDropdown / Live Log. Multiple runIds are subscribed in parallel.
 */
export function useRunEvents(runIds: string[]) {
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const key = runIds.join(",");

  React.useEffect(() => {
    if (runIds.length === 0) return;
    setEvents([]);
    setRunning(true);
    const sources: EventSource[] = [];
    let open = runIds.length;

    for (const runId of runIds) {
      const es = new EventSource(`${API_BASE}/runs/${runId}/events`);
      const onMsg = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as RunEvent;
          setEvents((prev) => [...prev, parsed]);
          // Runtime agent failures arrive as SSE `error` events (not as a
          // mutation/query error), so the global error toast never sees them —
          // surface them here so the user gets a notification without a reload.
          if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);
        } catch {
          /* ignore non-JSON keepalive frames (and dataless native error events) */
        }
      };
      // The server tags events with kind as the SSE `event:` name AND emits them
      // as default messages too in some clients — listen broadly.
      es.onmessage = onMsg;
      for (const kind of ["info", "tool", "result", "error"]) {
        es.addEventListener(kind, onMsg as EventListener);
      }
      es.onerror = () => {
        es.close();
        open -= 1;
        if (open <= 0) setRunning(false);
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { events, running };
}
