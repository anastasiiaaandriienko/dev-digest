/* hooks/context.ts — React Query hooks for the Project Context folder
   (specs/project-context-folder): effective roots, the discovered-doc list
   (metadata only), the read-only preview, and the agent / skill attachments.
   Keys: ["context", repoId, "roots" | "list" | "file" | "usage", …] and
   ["context-docs", kind, ownerId, repoId]. There is no write, edit or re-index
   endpoint: "Re-index" in the UI is just a refetch of the list query. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContextAttachment, ContextFile, ContextList, ContextRoots, ContextUsage } from "@devdigest/shared";
import { api } from "../api";

/** Which owner an attachment belongs to (the route prefix). */
export type ContextOwnerKind = "agents" | "skills";

export const contextRepoKey = (repoId: string) => ["context", repoId] as const;
export const contextRootsKey = (repoId: string) => ["context", repoId, "roots"] as const;
export const contextListKey = (repoId: string, q: string) => ["context", repoId, "list", q] as const;
export const contextFileKey = (repoId: string, path: string) => ["context", repoId, "file", path] as const;
export const contextUsageKey = (repoId: string) => ["context", repoId, "usage"] as const;
export const contextDocsKey = (kind: ContextOwnerKind, ownerId: string, repoId: string) =>
  ["context-docs", kind, ownerId, repoId] as const;

/** GET /repos/:id/context/roots — the effective roots (defaults when none saved). */
export function useContextRoots(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextRootsKey(repoId ?? ""),
    queryFn: () => api.get<ContextRoots>(`/repos/${repoId}/context/roots`),
    enabled: !!repoId,
  });
}

/** PUT /repos/:id/context/roots — the next list uses the saved roots. */
export function useUpdateContextRoots(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roots: string[]) => api.put<ContextRoots>(`/repos/${repoId}/context/roots`, { roots }),
    onSuccess: (saved) => {
      qc.setQueryData(contextRootsKey(repoId), saved);
      // Discovery depends on the roots; attachment statuses depend on them too.
      return Promise.all([
        qc.invalidateQueries({ queryKey: [...contextRepoKey(repoId), "list"] }),
        qc.invalidateQueries({ queryKey: ["context-docs"] }),
      ]);
    },
  });
}

/** GET /repos/:id/context?q= — discovered docs (path, size, updated_at). Refetch = "Re-index". */
export function useContextList(repoId: string | null | undefined, q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: contextListKey(repoId ?? "", query),
    queryFn: () =>
      api.get<ContextList>(`/repos/${repoId}/context${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    enabled: !!repoId,
    retry: false,
  });
}

/** GET /repos/:id/context/file?path= — read-only preview of ONE discovered doc. */
export function useContextFile(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: contextFileKey(repoId ?? "", path ?? ""),
    queryFn: () => api.get<ContextFile>(`/repos/${repoId}/context/file?path=${encodeURIComponent(path ?? "")}`),
    enabled: !!repoId && !!path,
    retry: false,
  });
}

/** GET /repos/:id/context/usage — how many agents use each doc path (DB only). Not refetched by Re-index. */
export function useContextUsage(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextUsageKey(repoId ?? ""),
    queryFn: () => api.get<ContextUsage>(`/repos/${repoId}/context/usage`),
    enabled: !!repoId,
    retry: false,
  });
}

/** GET /agents|skills/:id/context-docs?repo_id= */
export function useContextDocs(kind: ContextOwnerKind, ownerId: string | null | undefined, repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextDocsKey(kind, ownerId ?? "", repoId ?? ""),
    queryFn: () => api.get<ContextAttachment[]>(`/${kind}/${ownerId}/context-docs?repo_id=${repoId}`),
    enabled: !!ownerId && !!repoId,
  });
}

/** POST /agents|skills/:id/context-docs?repo_id= — attach a discovered doc (idempotent). */
export function useAttachContextDoc(kind: ContextOwnerKind, ownerId: string, repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) =>
      api.post<ContextAttachment>(`/${kind}/${ownerId}/context-docs?repo_id=${repoId}`, { path }),
    // The "Used by N agents" counts change with every attach / detach.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: contextDocsKey(kind, ownerId, repoId) }),
        qc.invalidateQueries({ queryKey: contextUsageKey(repoId) }),
      ]),
  });
}

/** PUT /agents|skills/:id/context-docs/order — all attachment ids in the new order.
    Not optimistic (A-1): the response is the cache; a failure refetches server truth. */
export function useReorderContextDocs(kind: ContextOwnerKind, ownerId: string, repoId: string) {
  const qc = useQueryClient();
  const key = contextDocsKey(kind, ownerId, repoId);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api.put<ContextAttachment[]>(`/${kind}/${ownerId}/context-docs/order?repo_id=${repoId}`, { ids }),
    onSuccess: (ordered) => {
      qc.setQueryData(key, ordered);
      return qc.invalidateQueries({ queryKey: key });
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** DELETE /agents|skills/:id/context-docs/:docId — detach one row. */
export function useDetachContextDoc(kind: ContextOwnerKind, ownerId: string, repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.del<{ ok: boolean }>(`/${kind}/${ownerId}/context-docs/${docId}`),
    // The "Used by N agents" counts change with every attach / detach.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: contextDocsKey(kind, ownerId, repoId) }),
        qc.invalidateQueries({ queryKey: contextUsageKey(repoId) }),
      ]),
  });
}
