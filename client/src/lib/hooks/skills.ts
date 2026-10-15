/* hooks/skills.ts — React Query hooks for the Skills Lab (HW2): list, one skill,
   create, update, delete, version history and restore over the server's
   /skills API. Keys: ["skills"] (list), ["skill", id], ["skill-versions", id]. */
"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillRestoreResult, SkillType, SkillVersion } from "@devdigest/shared";

export const SKILLS_KEY = ["skills"] as const;
export const skillKey = (id: string) => ["skill", id] as const;
export const skillVersionsKey = (id: string) => ["skill-versions", id] as const;

/** After a write to one skill: refresh the list, the skill page and its history. */
function invalidateSkill(qc: QueryClient, id: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: SKILLS_KEY }),
    qc.invalidateQueries({ queryKey: skillKey(id) }),
    qc.invalidateQueries({ queryKey: skillVersionsKey(id) }),
  ]);
}

export function useSkills() {
  return useQuery({
    queryKey: SKILLS_KEY,
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

/** One skill for the /skills/:id page. */
export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKey(id ?? ""),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Body history, newest first (`current` marks the live version). */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillVersionsKey(id ?? ""),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
}

/** POST …/versions/:version/restore — the old body comes back as a NEW version. */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillVersionInput) =>
      api.post<SkillRestoreResult>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (result, { id }) => {
      qc.setQueryData(skillKey(id), result.skill);
      return invalidateSkill(qc, id);
    },
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    // Put the new skill in the list at once (its preview opens right away),
    // then refetch to pick up the server's ordering.
    onSuccess: (skill) => {
      qc.setQueryData<Skill[]>(SKILLS_KEY, (old) => (old ? [skill, ...old.filter((x) => x.id !== skill.id)] : old));
      return qc.invalidateQueries({ queryKey: SKILLS_KEY });
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

/** Replace one skill in a cached list (pure; exported for tests). */
export function patchSkill(list: Skill[] | undefined, id: string, patch: Partial<Skill>): Skill[] | undefined {
  return list?.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

/**
 * PUT /skills/:id. Optimistic: the card (and an open preview) read ["skills"],
 * so a toggle flips at once; on error only this skill rolls back. The global
 * MutationCache onError already shows the error toast.
 */
export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: SKILLS_KEY });
      const before = qc.getQueryData<Skill[]>(SKILLS_KEY)?.find((s) => s.id === id);
      qc.setQueryData<Skill[]>(SKILLS_KEY, (old) => patchSkill(old, id, patch));
      return before ? { previous: before } : undefined;
    },
    onError: (_err, { id }, ctx) => {
      if (ctx) qc.setQueryData<Skill[]>(SKILLS_KEY, (old) => patchSkill(old, id, ctx.previous));
    },
    // The skill page shows the saved state at once; a changed body also added a version.
    onSuccess: (skill, { id }) => qc.setQueryData(skillKey(id), skill),
    onSettled: (_d, _e, { id }) => invalidateSkill(qc, id),
  });
}

/**
 * DELETE /skills/:id. Not optimistic (it cannot be undone): the card disappears
 * once the server confirms; versions and agent links go with it server-side,
 * the agents themselves stay.
 */
export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.setQueryData<Skill[]>(SKILLS_KEY, (old) => old?.filter((s) => s.id !== id));
      // Drop cached copies of the gone skill, but only INACTIVE ones: removing a
      // query the still-mounted skill page observes makes it refetch → a 404
      // right before the page navigates away. The page's own copy is left to gc.
      qc.removeQueries({ queryKey: skillKey(id), type: "inactive" });
      qc.removeQueries({ queryKey: skillVersionsKey(id), type: "inactive" });
      return qc.invalidateQueries({ queryKey: SKILLS_KEY });
    },
  });
}
