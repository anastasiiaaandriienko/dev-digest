/**
 * L07 B9 — CI hooks (specs/export-to-ci.md §6.1) against a real QueryClient (the
 * app's createQueryClient, so the silent/toast error policy is the real one) with
 * the HTTP layer mocked: request paths and bodies, query keys, invalidation after
 * export and sync, error handling and the zip download.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
const postBlob = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      postBlob: (...a: unknown[]) => postBlob(...a),
    },
  };
});

import { ApiError } from "../api";
import { createQueryClient } from "../providers";
import { notify } from "../toast";
import {
  ciKeys,
  ciZipFilename,
  useCiAutoSync,
  useCiInstallations,
  useCiPreview,
  useCiRuns,
  useCiSync,
  useExportCi,
  useExportCiZip,
  useRepoCiInstallations,
} from "./ci";

const AGENT = "11111111-1111-4111-8111-111111111111";
let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const SYNC_RESULT = { ingested: 0, throttled: 0, skipped: [], errors: [] };

beforeEach(() => {
  qc = createQueryClient();
  qc.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  get.mockReset();
  post.mockReset();
  postBlob.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("queries", () => {
  it("useCiInstallations GETs the agent's installations, and waits for an agent id", async () => {
    get.mockResolvedValue([{ id: "i1" }]);
    const none = renderHook(() => useCiInstallations(undefined), { wrapper });
    expect(none.result.current.fetchStatus).toBe("idle");
    const { result } = renderHook(() => useCiInstallations(AGENT), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "i1" }]));
    expect(get).toHaveBeenCalledWith(`/agents/${AGENT}/ci/installations`);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("useRepoCiInstallations encodes owner/name and skips an incomplete repo", async () => {
    get.mockResolvedValue([]);
    renderHook(() => useRepoCiInstallations("acme"), { wrapper });
    const { result } = renderHook(() => useRepoCiInstallations("acme/widgets.v2"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/ci/installations?repo=acme%2Fwidgets.v2");
  });

  it("useCiRuns passes the URL filters and keys the cache by them", async () => {
    get.mockResolvedValue([]);
    const all = renderHook(() => useCiRuns(), { wrapper });
    const filtered = renderHook(() => useCiRuns({ agentId: AGENT, repo: "acme/widgets" }), { wrapper });
    await waitFor(() => expect(all.result.current.isSuccess && filtered.result.current.isSuccess).toBe(true));
    expect(get.mock.calls.map((c) => c[0])).toEqual(["/ci/runs", `/ci/runs?agent_id=${AGENT}&repo=acme%2Fwidgets`]);
    expect(qc.getQueryData(ciKeys.runsFor({}))).toEqual([]);
    expect(qc.getQueryData(ciKeys.runsFor({ agentId: AGENT, repo: "acme/widgets" }))).toEqual([]);
  });

  it("a failed query exposes the ApiError", async () => {
    get.mockRejectedValue(new ApiError("Agent not found", 404, "not_found"));
    const { result } = renderHook(() => useCiInstallations(AGENT), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("sync", () => {
  it("a manual sync posts the input and refreshes runs and installations", async () => {
    post.mockResolvedValue({ ...SYNC_RESULT, ingested: 2 });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCiSync(), { wrapper });
    await act(() => result.current.mutateAsync({ mode: "manual", installation_id: "i1" }));
    expect(post).toHaveBeenCalledWith("/ci/runs/sync", { mode: "manual", installation_id: "i1" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ciKeys.runs });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ciKeys.installations });
  });

  it("a failed manual sync shows a toast; an automatic one stays silent", async () => {
    const toast = vi.spyOn(notify, "error").mockImplementation(() => undefined as never);
    post.mockRejectedValue(new ApiError("GitHub request failed", 502, "external_service_error"));
    const manual = renderHook(() => useCiSync(), { wrapper });
    await act(() => manual.result.current.mutateAsync({ mode: "manual" }).catch(() => undefined));
    expect(toast).toHaveBeenCalledWith("GitHub request failed");

    toast.mockClear();
    const auto = renderHook(() => useCiAutoSync(), { wrapper });
    await waitFor(() => expect(auto.result.current.isError).toBe(true));
    expect(toast).not.toHaveBeenCalled();
  });

  it("the automatic sync runs once per mount (mode auto) and only refreshes when something happened", async () => {
    post.mockResolvedValue(SYNC_RESULT);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result, rerender } = renderHook(() => useCiAutoSync(), { wrapper });
    rerender();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/ci/runs/sync", { mode: "auto" });
    expect(invalidate).not.toHaveBeenCalled();

    post.mockResolvedValue({ ...SYNC_RESULT, ingested: 1 });
    const second = renderHook(() => useCiAutoSync(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ciKeys.runs });
  });

  it("a disabled automatic sync sends nothing", () => {
    renderHook(() => useCiAutoSync(false), { wrapper });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("preview and export", () => {
  const body = { repo: "acme/widgets", triggers: ["opened" as const] };

  it("preview posts the input; its error is left to the wizard (no toast)", async () => {
    const toast = vi.spyOn(notify, "error").mockImplementation(() => undefined as never);
    post.mockResolvedValueOnce({ files: [{ path: "a", contents: "b", editable: false }] });
    const { result } = renderHook(() => useCiPreview(), { wrapper });
    const res = await act(() => result.current.mutateAsync({ agentId: AGENT, body }));
    expect(res.files).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(`/agents/${AGENT}/ci/preview`, body);

    post.mockRejectedValueOnce(new ApiError("conflict", 409, "ci_file_conflict", { paths: ["x"] }));
    await act(() => result.current.mutateAsync({ agentId: AGENT, body }).catch(() => undefined));
    await waitFor(() => expect(result.current.error).toMatchObject({ code: "ci_file_conflict", details: { paths: ["x"] } }));
    expect(toast).not.toHaveBeenCalled();
  });

  it("export opens the PR (action open_pr) and refreshes installations, not runs", async () => {
    post.mockResolvedValue({ installation: { id: "i1" }, files: [], pr_url: "https://github.com/acme/widgets/pull/1" });
    qc.setQueryData(ciKeys.agentInstallations(AGENT), []);
    qc.setQueryData(ciKeys.repoInstallations("acme/widgets"), []);
    qc.setQueryData(ciKeys.runsFor({}), []);
    const { result } = renderHook(() => useExportCi(), { wrapper });
    const res = await act(() => result.current.mutateAsync({ agentId: AGENT, body: { ...body, action: "files" } }));
    expect(res.pr_url).toBe("https://github.com/acme/widgets/pull/1");
    expect(post).toHaveBeenCalledWith(`/agents/${AGENT}/export-ci`, { ...body, action: "open_pr" });
    expect(qc.getQueryState(ciKeys.agentInstallations(AGENT))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(ciKeys.repoInstallations("acme/widgets"))!.isInvalidated).toBe(true);
    expect(qc.getQueryState(ciKeys.runsFor({}))!.isInvalidated).toBe(false);
  });

  it("a failed export keeps the cache, shows no toast and exposes the 409 to the wizard", async () => {
    const toast = vi.spyOn(notify, "error").mockImplementation(() => undefined as never);
    post.mockRejectedValue(new ApiError("taken", 409, "ci_repo_has_agent", { agent_name: "Perf" }));
    qc.setQueryData(ciKeys.agentInstallations(AGENT), []);
    const { result } = renderHook(() => useExportCi(), { wrapper });
    await act(() => result.current.mutateAsync({ agentId: AGENT, body }).catch(() => undefined));
    await waitFor(() => expect(result.current.error).toMatchObject({ status: 409, code: "ci_repo_has_agent" }));
    expect(qc.getQueryState(ciKeys.agentInstallations(AGENT))!.isInvalidated).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("zip download", () => {
  let created: Blob[];
  let revoked: string[];
  let clicks: { href: string; download: string }[];

  beforeEach(() => {
    created = [];
    revoked = [];
    clicks = [];
    Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        created.push(b);
        return `blob:local/${created.length}`;
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("ciZipFilename mirrors the server slug", () => {
    expect(ciZipFilename("Security Reviewer")).toBe("devdigest-ci-security-reviewer.zip");
    expect(ciZipFilename("Café — Été v2")).toBe("devdigest-ci-cafe-ete-v2.zip");
    expect(ciZipFilename("日本")).toBe("devdigest-ci-agent.zip");
  });

  it("posts through the API client (no token or query in the URL), saves the blob under the agent's name, revokes the URL and refreshes installations", async () => {
    const zip = new Blob([new Uint8Array([0x50, 0x4b, 3, 4])], { type: "application/zip" });
    postBlob.mockResolvedValue(zip);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const body = { repo: "acme/widgets", triggers: ["opened" as const] };
    const { result } = renderHook(() => useExportCiZip(), { wrapper });
    const res = await act(() => result.current.mutateAsync({ agentId: AGENT, agentName: "Security Reviewer", body }));
    expect(postBlob).toHaveBeenCalledWith(`/agents/${AGENT}/export-ci/zip`, body);
    expect(postBlob.mock.calls[0]![0]).not.toContain("?");
    expect(res).toEqual({ filename: "devdigest-ci-security-reviewer.zip", size: 4 });
    expect(created).toEqual([zip]);
    expect(clicks).toEqual([{ href: "blob:local/1", download: "devdigest-ci-security-reviewer.zip" }]);
    expect(revoked).toEqual(["blob:local/1"]);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0); // the temporary link is removed
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ciKeys.installations });
  });

  it("a failed zip export downloads nothing and refreshes nothing", async () => {
    postBlob.mockRejectedValue(new ApiError("bundle missing", 500, "ci_runner_bundle_missing"));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useExportCiZip(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ agentId: AGENT, agentName: "A", body: { repo: "acme/widgets" } }).catch(() => undefined),
    );
    await waitFor(() => expect(result.current.error).toMatchObject({ code: "ci_runner_bundle_missing" }));
    expect(created).toEqual([]);
    expect(clicks).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
