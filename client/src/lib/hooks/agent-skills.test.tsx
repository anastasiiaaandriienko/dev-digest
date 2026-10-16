/**
 * Agent ↔ skills hooks (HW2 #13) against a real QueryClient with the HTTP
 * layer mocked: GET the ordered links, PUT the whole list with an optimistic
 * update that rolls back on error, and the refreshes afterwards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentSkillLink } from "@devdigest/shared";

const get = vi.fn();
const put = vi.fn();
vi.mock("../api", () => ({
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
  API_BASE: "",
}));

import { agentSkillsKey, linksFromItems, useAgents, useAgentSkills, useAgentsUsingSkill, useSetAgentSkills } from "./agents";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);
const BEFORE: AgentSkillLink[] = [
  { agent_id: "ag", skill_id: "a", order: 0, enabled: true },
  { agent_id: "ag", skill_id: "b", order: 1, enabled: false },
];
const cached = () => qc.getQueryData<AgentSkillLink[]>(agentSkillsKey("ag"));

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockReset();
  put.mockReset();
});

describe("linksFromItems", () => {
  it("array position becomes the order", () => {
    expect(linksFromItems("ag", [{ skill_id: "b", enabled: true }, { skill_id: "a", enabled: false }])).toEqual([
      { agent_id: "ag", skill_id: "b", order: 0, enabled: true },
      { agent_id: "ag", skill_id: "a", order: 1, enabled: false },
    ]);
  });
});

describe("useAgentSkills", () => {
  it("GETs /agents/:id/skills; disabled without an id", async () => {
    get.mockResolvedValue(BEFORE);
    const { result } = renderHook(() => useAgentSkills("ag"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/agents/ag/skills");
    get.mockClear();
    renderHook(() => useAgentSkills(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useSetAgentSkills", () => {
  const NEXT = [
    { skill_id: "b", enabled: true },
    { skill_id: "a", enabled: true },
  ];

  it("shows the new order at once, PUTs { skills } and refreshes links + skills", async () => {
    qc.setQueryData(agentSkillsKey("ag"), BEFORE);
    let resolve!: (v: AgentSkillLink[]) => void;
    put.mockReturnValue(new Promise<AgentSkillLink[]>((r) => (resolve = r)));
    get.mockReturnValue(new Promise(() => {}));
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useSetAgentSkills("ag"), { wrapper });
    act(() => result.current.mutate(NEXT));

    await waitFor(() => expect(cached()!.map((l) => `${l.skill_id}:${l.order}:${l.enabled}`)).toEqual(["b:0:true", "a:1:true"]));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/agents/ag/skills", { skills: NEXT }));

    act(() => resolve(linksFromItems("ag", NEXT)));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["skills"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: agentSkillsKey("ag") });
  });

  it("quick successive saves: PUTs run in click order and an earlier answer does not overwrite the newer list", async () => {
    qc.setQueryData(agentSkillsKey("ag"), BEFORE);
    const resolvers: ((v: AgentSkillLink[]) => void)[] = [];
    put.mockImplementation(() => new Promise<AgentSkillLink[]>((r) => resolvers.push(r)));
    get.mockReturnValue(new Promise(() => {}));
    const THIRD = [
      { skill_id: "a", enabled: false },
      { skill_id: "b", enabled: true },
    ];

    const { result } = renderHook(() => useSetAgentSkills("ag"), { wrapper });
    act(() => result.current.mutate(NEXT));
    act(() => result.current.mutate(THIRD));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1)); // the second waits for the first
    expect(cached()).toEqual(linksFromItems("ag", THIRD));

    act(() => resolvers[0]!(linksFromItems("ag", NEXT)));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith("/agents/ag/skills", { skills: THIRD });
    expect(cached()).toEqual(linksFromItems("ag", THIRD)); // not reverted to NEXT

    act(() => resolvers[1]!(linksFromItems("ag", THIRD)));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(cached()).toEqual(linksFromItems("ag", THIRD));
  });

  it("rolls back to the previous list when the PUT fails", async () => {
    qc.setQueryData(agentSkillsKey("ag"), BEFORE);
    put.mockRejectedValue(new Error("422"));
    get.mockReturnValue(new Promise(() => {})); // keep the refetch pending so the cache stays observable

    const { result } = renderHook(() => useSetAgentSkills("ag"), { wrapper });
    act(() => result.current.mutate(NEXT));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached()).toEqual(BEFORE);
  });
});

describe("useSetAgentSkills → agent cards' skill_count (regression: count stayed stale until reload)", () => {
  /** Server state: how many skills each agent has; GET /agents reads it. */
  let counts: Record<string, number>;
  beforeEach(() => {
    counts = { ag: 1 };
    get.mockImplementation((path: string) =>
      path === "/agents"
        ? Promise.resolve([{ id: "ag", name: "API Contract Reviewer", skill_count: counts.ag }])
        : new Promise(() => {}), // agent-skills refetch: keep pending
    );
  });

  /** The agents list (what /agents and the /agents/:id sidebar render) + the save hook, one QueryClient. */
  function renderBoth() {
    return renderHook(() => ({ agents: useAgents(), save: useSetAgentSkills("ag") }), { wrapper });
  }
  const shownCount = (r: { current: { agents: { data?: { skill_count?: number }[] } } }) => r.current.agents.data?.[0]?.skill_count;

  it("attaching a skill updates the card count without a reload", async () => {
    const { result } = renderBoth();
    await waitFor(() => expect(shownCount(result)).toBe(1));
    put.mockImplementation(async (_p: string, body: { skills: unknown[] }) => {
      counts.ag = body.skills.length; // the server now has 2 links
      return linksFromItems("ag", body.skills as { skill_id: string; enabled: boolean }[]);
    });
    await act(() => result.current.save.mutateAsync([{ skill_id: "a", enabled: true }, { skill_id: "b", enabled: true }]));
    await waitFor(() => expect(shownCount(result)).toBe(2));
  });

  it("detaching a skill updates the card count without a reload", async () => {
    counts.ag = 2;
    const { result } = renderBoth();
    await waitFor(() => expect(shownCount(result)).toBe(2));
    put.mockImplementation(async (_p: string, body: { skills: unknown[] }) => {
      counts.ag = body.skills.length;
      return linksFromItems("ag", body.skills as { skill_id: string; enabled: boolean }[]);
    });
    await act(() => result.current.save.mutateAsync([{ skill_id: "a", enabled: true }]));
    await waitFor(() => expect(shownCount(result)).toBe(1));
  });

  it("a failed save does not refetch the agents list", async () => {
    const { result } = renderBoth();
    await waitFor(() => expect(shownCount(result)).toBe(1));
    const agentsFetches = () => get.mock.calls.filter(([p]) => p === "/agents").length;
    const before = agentsFetches();
    put.mockRejectedValue(new Error("422"));
    await act(() => result.current.save.mutateAsync([{ skill_id: "x", enabled: true }]).catch(() => undefined));
    // Give a deferred refetch the chance to happen, so it would be caught too.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(agentsFetches()).toBe(before);
    expect(shownCount(result)).toBe(1);
  });
});

describe("useAgentsUsingSkill (Skill Editor · Stats)", () => {
  it("returns the agents whose links include the skill, with that link's enabled flag; GET only", async () => {
    get.mockImplementation((path: string) => {
      if (path === "/agents") return Promise.resolve([{ id: "a1", name: "One" }, { id: "a2", name: "Two" }, { id: "a3", name: "Three" }]);
      if (path === "/agents/a1/skills") return Promise.resolve([{ agent_id: "a1", skill_id: "sk", order: 0, enabled: true }]);
      if (path === "/agents/a2/skills") return Promise.resolve([{ agent_id: "a2", skill_id: "other", order: 0, enabled: true }]);
      return Promise.resolve([{ agent_id: "a3", skill_id: "sk", order: 1, enabled: false }]);
    });
    const { result } = renderHook(() => useAgentsUsingSkill("sk"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data.map((u) => [u.agent.id, u.enabled])).toEqual([
      ["a1", true],
      ["a3", false],
    ]);
    expect(result.current.isError).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  it("no agents → empty, not loading", async () => {
    get.mockResolvedValue([]);
    const { result } = renderHook(() => useAgentsUsingSkill("sk"), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});
