/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentSkillLink, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

// ---- Agent ↔ skills (HW2 #13): the ordered list that becomes the prompt ----

export const agentSkillsKey = (agentId: string) => ["agent-skills", agentId] as const;

/** The agent's linked skills, in prompt order, with the per-agent `enabled` switch. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentSkillsKey(agentId ?? ""),
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** One entry of the list sent to PUT (array order = prompt order). */
export interface AgentSkillItem {
  skill_id: string;
  enabled: boolean;
}

/** The links an item list would produce (pure; used for the optimistic update). */
export function linksFromItems(agentId: string, items: readonly AgentSkillItem[]): AgentSkillLink[] {
  return items.map((i, order) => ({ agent_id: agentId, skill_id: i.skill_id, order, enabled: i.enabled }));
}

/**
 * PUT /agents/:id/skills — replace the whole ordered list (attach, detach,
 * enable/disable, reorder all go through here). Optimistic: the tab shows the
 * new order at once; on error the previous list comes back (the global
 * MutationCache onError shows the toast). Skill agent_count changes, so the
 * skills list is refreshed too.
 *
 * Quick successive edits (↑ ↑ ↑) each build on the optimistic list: the PUTs
 * run one at a time in click order (`scope`), and only the last one in flight
 * writes the server answer / rolls back / refetches — an earlier response
 * must not put an older order back under a newer optimistic one.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  const key = agentSkillsKey(agentId);
  // `isMutating` still counts the mutation whose callback is running.
  const isLast = () => qc.isMutating({ mutationKey: key }) <= 1;
  return useMutation({
    mutationKey: key,
    scope: { id: key.join(":") },
    mutationFn: (items: AgentSkillItem[]) => api.put<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skills: items }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentSkillLink[]>(key);
      qc.setQueryData<AgentSkillLink[]>(key, linksFromItems(agentId, items));
      return { previous };
    },
    onError: (_err, _items, ctx) => {
      if (ctx && isLast()) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (links) => {
      if (isLast()) qc.setQueryData(key, links);
    },
    onSettled: () => {
      if (isLast()) qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
