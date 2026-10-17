/* hooks/intent.ts — L03 PR Intent block.
   GET /pulls/:id/intent is a pure local read (no LLM). POST runs the (paid) LLM
   and is therefore never retried automatically and never fired from a query. */
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  notifyManager,
  useQuery,
  useMutation,
  useQueryClient,
  type QueryState,
} from "@tanstack/react-query";
import { api, ApiError } from "../api";
import { finishedActiveRunIds, type ActiveRun } from "./reviews";
import type { PrIntentState } from "@devdigest/shared";

export const intentKey = (prId: string | null | undefined) => ["pr-intent", prId] as const;

/**
 * Read the stored intent + freshness + model preview. GET only.
 * `enabled` lets the page wait until the PR detail has loaded and settled, so the
 * read does not race the pr_files resync.
 */
export function usePrIntent(prId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: intentKey(prId),
    queryFn: () => api.get<PrIntentState>(`/pulls/${prId}/intent`),
    enabled: !!prId && enabled,
    refetchOnWindowFocus: false,
  });
}

/**
 * Read-only view of a query owned by someone else (the page's hooks). Subscribes to
 * the QueryCache only — it creates NO observer, so it never fetches, never writes
 * options (no `queryFn`) onto the shared Query, and cannot trigger "No queryFn" errors.
 * `query.state` is replaced (not mutated) on every change, so the snapshot is
 * referentially stable between changes.
 */
function useQueryStateReadOnly<T = unknown>(key: readonly unknown[]): QueryState<T, Error> | undefined {
  const qc = useQueryClient();
  // Stable subscribe (no resubscribe per render); batchCalls defers the listener the
  // same way react-query's own hooks do (useIsFetching), avoiding render-phase updates.
  const subscribe = useCallback(
    (cb: () => void) => qc.getQueryCache().subscribe(notifyManager.batchCalls(cb)),
    [qc],
  );
  return useSyncExternalStore(
    subscribe,
    () => qc.getQueryState<T>(key),
    () => undefined,
  );
}

/**
 * True once the PR detail query (`["pull", prId]`, owned by `usePullDetail`) has
 * data and is not fetching — i.e. the server's pr_files resync is finished.
 * `GET /pulls/:id` rewrites pr_files non-transactionally, so an intent read in
 * that window can report a spurious freshness.
 *
 * - First render: the page's own observer starts its (stale-cache) refetch in a
 *   parent effect, AFTER this child's first render. We therefore also wait one
 *   mount tick so that fetch has already begun and shows as `fetching`.
 * - Whenever it settles and the detail data is newer than the cached intent data,
 *   the intent query is invalidated (GET only) so a read made during the resync
 *   (or a fresh-looking cached one) is corrected.
 * Read-only cache subscription (no observer): it never fetches itself.
 *
 * `dependentKey` picks the pr_files-derived query to re-read (default: the intent);
 * the Blast Radius block passes its own key. Derive it from `prId` only.
 */
export function usePullSettled(
  prId: string | null | undefined,
  dependentKey: (id: string | null | undefined) => readonly unknown[] = intentKey,
): boolean {
  const qc = useQueryClient();
  const detail = useQueryStateReadOnly(["pull", prId]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const settled = mounted && detail?.status === "success" && detail.fetchStatus === "idle";
  const updatedAt = detail?.dataUpdatedAt ?? 0;
  useEffect(() => {
    if (!settled) return;
    // Data older than the detail that just settled may have been read during
    // the pr_files resync → re-read once (GET). No loop: this effect only re-runs when
    // `settled`/`updatedAt` change, and after the re-read the data is newer than detail.
    // No data yet (0) → skip: the `enabled` flip already fetches it (no double GET).
    const key = dependentKey(prId);
    const dataAt = qc.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (dataAt > 0 && updatedAt > dataAt) {
      void qc.invalidateQueries({ queryKey: key });
    }
    // dependentKey is a stable key factory (derived from prId), so it is not a dependency.
  }, [settled, updatedAt, prId, qc]);

  return settled;
}

/**
 * Re-read the intent (GET only) after a review run completes: a run changes the
 * stored review state and the intent freshness can follow. Completion = a run id
 * present in the previous `["pr-active-runs", prId]` data and gone now (the page
 * owns that query via `usePrActiveRuns`; this is a read-only cache subscription, no observer).
 * - No loop / no storm: invalidation happens only when a run id actually disappears
 *   (a diff of consecutive snapshots), so identical updates are no-ops; the effect
 *   never writes the query it watches. It never POSTs.
 * - Mount guard (returning to the Overview tab inside staleTime): if the active-runs
 *   list is empty and newer than the cached intent, a run finished while this block
 *   was unmounted → invalidate once (runs once per mount/prId, not per render).
 */
export function useRefreshIntentOnRunsSettled(prId: string | null | undefined) {
  const qc = useQueryClient();
  const runs = useQueryStateReadOnly<ActiveRun[]>(["pr-active-runs", prId])?.data;
  const prev = useRef<{ prId: string | null | undefined; runs: ActiveRun[] | undefined }>({
    prId,
    runs: undefined,
  });

  useEffect(() => {
    const base = prev.current.prId === prId ? prev.current.runs : undefined;
    const finished = finishedActiveRunIds(base, runs);
    prev.current = { prId, runs };
    if (finished.length > 0) void qc.invalidateQueries({ queryKey: intentKey(prId) });
  }, [runs, prId, qc]);

  useEffect(() => {
    if (!prId) return;
    const active = qc.getQueryState<ActiveRun[]>(["pr-active-runs", prId]);
    const activeAt = active?.dataUpdatedAt ?? 0;
    const intentAt = qc.getQueryState(intentKey(prId))?.dataUpdatedAt ?? 0;
    if (activeAt > 0 && intentAt > 0 && activeAt > intentAt && active?.data?.length === 0) {
      void qc.invalidateQueries({ queryKey: intentKey(prId) });
    }
  }, [prId, qc]);
}

/** Explicit "Run intent" (force=false) / "Recalculate" (force=true). Never auto-retried. */
export function useRunIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["pr-intent-run", prId],
    mutationFn: ({ force }: { force: boolean }) =>
      api.post<PrIntentState>(`/pulls/${prId}/intent`, { force }),
    retry: 0, // a paid LLM call must never be retried automatically
    meta: { silent: true }, // IntentBlock renders its own inline error → no global toast
    onSuccess: (state) => {
      qc.setQueryData(intentKey(prId), state);
    },
    onError: (err) => {
      // 409/422 mean our view of the inputs/model is out of date → re-read the
      // state (model preview, freshness) with a GET. Never re-POSTs.
      const kind = classifyIntentError(err);
      if (kind === "inputs_incomplete" || kind === "model_unavailable") {
        void qc.invalidateQueries({ queryKey: intentKey(prId) });
      }
    },
  });
}

export type IntentErrorKind =
  | "inputs_incomplete"
  | "model_unavailable"
  | "rate_limited"
  | "provider_error"
  | "timeout"
  | "save_failed"
  | "not_found"
  | "unknown";

/** Map an API failure to a stable kind the UI turns into fixed, friendly text. */
export function classifyIntentError(err: unknown): IntentErrorKind {
  if (!(err instanceof ApiError)) return "unknown";
  switch (err.code) {
    case "intent_inputs_incomplete":
      return "inputs_incomplete";
    case "intent_model_unavailable":
      return "model_unavailable";
    case "intent_timeout":
      return "timeout";
    case "intent_save_failed":
      return "save_failed";
    case "external_service_error":
      return "provider_error";
  }
  switch (err.status) {
    case 409:
      return "inputs_incomplete";
    case 429:
      return "rate_limited";
    case 502:
      return "provider_error";
    case 504:
      return "timeout";
    case 404:
      return "not_found";
    default:
      return "unknown";
  }
}
