/* hooks/skills.ts — React Query hooks for the Skills Lab (HW2): list, create and
   update over the server's /skills API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillType } from "@devdigest/shared";

export const SKILLS_KEY = ["skills"] as const;

export function useSkills() {
  return useQuery({
    queryKey: SKILLS_KEY,
    queryFn: () => api.get<Skill[]>("/skills"),
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
    onSettled: () => qc.invalidateQueries({ queryKey: SKILLS_KEY }),
  });
}
