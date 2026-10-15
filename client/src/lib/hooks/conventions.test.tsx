/** Conventions hooks (HW2 #38–#52) against a real QueryClient with the HTTP layer mocked. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionsState } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock("../api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) },
  API_BASE: "",
}));

import {
  applyCandidate,
  conventionsKey,
  conventionSkillDraftKey,
  useConventions,
  useCreateConventionSkill,
  useStartConventionScan,
  useUpdateConvention,
} from "./conventions";
import { SKILLS_KEY } from "./skills";
import { agentSkillsKey } from "./agents";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

const cand = (id: string, status: ConventionCandidate["status"] = "pending"): ConventionCandidate => ({
  id,
  repo_id: "r",
  rule: `rule ${id}`,
  category: "naming",
  evidence_path: "src/a.ts",
  evidence_line: 1,
  evidence_snippet: "x",
  confidence: 0.9,
  status,
  accepted: status === "accepted",
  scan_id: null,
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
});
const STATE: ConventionsState = {
  scan: null,
  candidates: [cand("a"), cand("b", "accepted")],
  counts: { pending: 1, accepted: 1, rejected: 2 },
};
const cached = () => qc.getQueryData<ConventionsState>(conventionsKey("r"));

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

describe("applyCandidate", () => {
  it("a rejected candidate leaves the list; counts move with the status", () => {
    expect(applyCandidate(STATE, cand("a", "rejected"))).toEqual({
      ...STATE,
      candidates: [STATE.candidates[1]],
      counts: { pending: 0, accepted: 1, rejected: 3 },
    });
    expect(applyCandidate(STATE, { ...cand("a", "accepted"), rule: "edited" }).candidates[0]).toMatchObject({ rule: "edited", accepted: true });
    expect(applyCandidate(STATE, cand("a", "accepted")).counts).toEqual({ pending: 0, accepted: 2, rejected: 2 });
  });
});

describe("useConventions", () => {
  it("GETs the repo state; polls only while a scan runs", async () => {
    get.mockResolvedValue({ ...STATE, scan: { status: "running" } });
    const { result } = renderHook(() => useConventions("r"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/repos/r/conventions");
    // still running → it fetches again by itself
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    get.mockClear();
    renderHook(() => useConventions(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useStartConventionScan", () => {
  it("POSTs { rescan } and shows the running scan at once", async () => {
    qc.setQueryData(conventionsKey("r"), STATE);
    post.mockResolvedValue({ id: "s1", status: "running" });
    get.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStartConventionScan("r"), { wrapper });
    await act(() => result.current.mutateAsync(true));
    expect(post).toHaveBeenCalledWith("/repos/r/conventions/extract", { rescan: true });
    expect(cached()!.scan).toMatchObject({ id: "s1", status: "running" });
  });
});

describe("useUpdateConvention", () => {
  it("rejecting hides the card at once and PATCHes; the skill draft is refreshed", async () => {
    qc.setQueryData(conventionsKey("r"), STATE);
    let resolve!: (v: ConventionCandidate) => void;
    patch.mockReturnValue(new Promise<ConventionCandidate>((r) => (resolve = r)));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateConvention("r"), { wrapper });
    act(() => result.current.mutate({ id: "a", patch: { status: "rejected" } }));
    await waitFor(() => expect(cached()!.candidates.map((c) => c.id)).toEqual(["b"]));
    expect(patch).toHaveBeenCalledWith("/conventions/a", { status: "rejected" });
    act(() => resolve(cand("a", "rejected")));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: conventionSkillDraftKey("r") }));
    expect(cached()!.counts).toEqual({ pending: 0, accepted: 1, rejected: 3 });
  });

  it("a failed PATCH brings the previous state back", async () => {
    qc.setQueryData(conventionsKey("r"), STATE);
    patch.mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => useUpdateConvention("r"), { wrapper });
    act(() => result.current.mutate({ id: "a", patch: { status: "rejected" } }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cached()).toEqual(STATE);
  });
});

describe("useCreateConventionSkill", () => {
  it("POSTs the reviewed draft and refreshes skills, agents and the attached agent's skills", async () => {
    post.mockResolvedValue({ skill: { id: "k" }, attached_agent_id: "ag" });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const body = { name: "repo-conventions", description: "", type: "convention" as const, enabled: true, body: "# x", agent_id: "ag" };
    const { result } = renderHook(() => useCreateConventionSkill("r"), { wrapper });
    await act(() => result.current.mutateAsync(body));
    expect(post).toHaveBeenCalledWith("/repos/r/conventions/skill", body);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SKILLS_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: agentSkillsKey("ag") });
  });
});
