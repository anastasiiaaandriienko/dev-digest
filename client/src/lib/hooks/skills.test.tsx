/**
 * Skills Lab hooks (HW2 #9, #12) against a real QueryClient with the HTTP layer
 * mocked: optimistic enabled toggle with per-skill rollback, refetch on settle,
 * and a created skill landing in the cached list at once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    del: (...a: unknown[]) => del(...a),
  },
  API_BASE: "",
}));

import {
  SKILLS_KEY,
  patchSkill,
  skillKey,
  skillVersionsKey,
  useCreateSkill,
  useDeleteSkill,
  useRestoreSkillVersion,
  useSkill,
  useSkillVersions,
  useSkills,
  useUpdateSkill,
} from "./skills";

function skill(id: string, o: Partial<Skill> = {}): Skill {
  return {
    id,
    name: id,
    description: "",
    type: "custom",
    source: "manual",
    body: "# x",
    enabled: true,
    version: 1,
    evidence_files: null,
    agent_count: 0,
    ...o,
  };
}

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const cached = () => qc.getQueryData<Skill[]>(SKILLS_KEY);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("patchSkill", () => {
  it("patches only the matching skill; undefined list stays undefined", () => {
    const list = [skill("a"), skill("b")];
    expect(patchSkill(list, "b", { enabled: false })!.map((s) => s.enabled)).toEqual([true, false]);
    expect(patchSkill(undefined, "a", { enabled: false })).toBeUndefined();
  });
});

describe("useSkills", () => {
  it("GETs /skills", async () => {
    get.mockResolvedValue([skill("a")]);
    const { result } = renderHook(() => useSkills(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills");
    expect(result.current.data!.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("useUpdateSkill", () => {
  it("flips enabled optimistically, PUTs the patch and refetches", async () => {
    qc.setQueryData(SKILLS_KEY, [skill("a"), skill("b")]);
    let resolve!: (v: Skill) => void;
    put.mockReturnValue(new Promise<Skill>((r) => (resolve = r)));
    get.mockResolvedValue([skill("a"), skill("b", { enabled: false })]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    act(() => result.current.mutate({ id: "b", patch: { enabled: false } }));

    await waitFor(() => expect(cached()!.find((s) => s.id === "b")!.enabled).toBe(false));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/skills/b", { enabled: false }));
    expect(cached()!.find((s) => s.id === "a")!.enabled).toBe(true);

    act(() => resolve(skill("b", { enabled: false })));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: SKILLS_KEY }));
  });

  it("rolls back only the failed skill", async () => {
    qc.setQueryData(SKILLS_KEY, [skill("a", { enabled: false }), skill("b")]);
    put.mockRejectedValue(new Error("boom"));
    get.mockReturnValue(new Promise(() => {})); // keep the refetch pending so the cache stays observable

    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    act(() => result.current.mutate({ id: "b", patch: { enabled: false } }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached()!.map((s) => [s.id, s.enabled])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});

describe("useCreateSkill", () => {
  it("POSTs the form and puts the new skill first in the cached list", async () => {
    qc.setQueryData(SKILLS_KEY, [skill("old")]);
    post.mockResolvedValue(skill("new", { name: "breaking-change" }));
    get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCreateSkill(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ name: "breaking-change", description: "d", type: "security", body: "# b" }),
    );

    expect(post).toHaveBeenCalledWith("/skills", {
      name: "breaking-change",
      description: "d",
      type: "security",
      body: "# b",
    });
    expect(cached()!.map((s) => s.id)).toEqual(["new", "old"]);
  });
});

describe("useDeleteSkill", () => {
  it("DELETEs /skills/:id and drops the skill from the cached list", async () => {
    qc.setQueryData(SKILLS_KEY, [skill("a"), skill("b")]);
    del.mockResolvedValue({ ok: true });
    get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    await act(() => result.current.mutateAsync("a"));
    expect(del).toHaveBeenCalledWith("/skills/a");
    expect(cached()!.map((s) => s.id)).toEqual(["b"]);
  });

  it("a failed delete leaves the cache untouched", async () => {
    qc.setQueryData(SKILLS_KEY, [skill("a")]);
    del.mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("a")).rejects.toThrow("500");
    });
    expect(cached()!.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("useSkill / useSkillVersions", () => {
  it("GET /skills/:id and /skills/:id/versions; disabled without an id", async () => {
    get.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("/versions") ? [{ version: 1 }] : skill("a")),
    );
    const one = renderHook(() => useSkill("a"), { wrapper });
    const hist = renderHook(() => useSkillVersions("a"), { wrapper });
    await waitFor(() => expect(one.result.current.isSuccess && hist.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills/a");
    expect(get).toHaveBeenCalledWith("/skills/a/versions");

    get.mockClear();
    renderHook(() => useSkill(null), { wrapper });
    renderHook(() => useSkillVersions(undefined), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useRestoreSkillVersion", () => {
  it("POSTs the restore, stores the returned skill and refreshes list, skill and history", async () => {
    post.mockResolvedValue({ skill: skill("a", { version: 5, body: "# old" }), restored: true, restored_from: 2 });
    get.mockReturnValue(new Promise(() => {}));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRestoreSkillVersion(), { wrapper });
    await act(() => result.current.mutateAsync({ id: "a", version: 2 }));

    expect(post).toHaveBeenCalledWith("/skills/a/versions/2/restore");
    expect(qc.getQueryData<Skill>(skillKey("a"))).toMatchObject({ version: 5, body: "# old" });
    for (const key of [SKILLS_KEY, skillKey("a"), skillVersionsKey("a")]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
  });
});

describe("useUpdateSkill — skill page caches", () => {
  it("a save updates the skill page cache and refreshes its version history", async () => {
    put.mockResolvedValue(skill("a", { body: "# new", version: 2 }));
    get.mockReturnValue(new Promise(() => {}));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateSkill(), { wrapper });
    await act(() => result.current.mutateAsync({ id: "a", patch: { body: "# new" } }));
    expect(qc.getQueryData<Skill>(skillKey("a"))).toMatchObject({ version: 2 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: skillVersionsKey("a") });
  });
});

describe("useDeleteSkill — skill page caches", () => {
  it("drops inactive caches of the deleted skill but never refetches an observed one", async () => {
    del.mockResolvedValue({ ok: true });
    get.mockReturnValue(new Promise(() => {}));
    qc.setQueryData(skillVersionsKey("a"), [{ version: 1 }]);
    qc.setQueryData(skillKey("a"), skill("a"));
    // The skill page is still mounted (an active observer on ["skill", "a"]).
    renderHook(() => useSkill("a"), { wrapper });
    get.mockClear();

    const { result } = renderHook(() => useDeleteSkill(), { wrapper });
    await act(() => result.current.mutateAsync("a"));

    expect(qc.getQueryData(skillVersionsKey("a"))).toBeUndefined();
    expect(qc.getQueryData(skillKey("a"))).toBeDefined();
    expect(get).not.toHaveBeenCalledWith("/skills/a");
  });
});
