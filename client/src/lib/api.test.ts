/**
 * api.ts — JSON and binary requests share one transport and one error policy
 * (L07 B9 added apiFetchBlob / api.postBlob for the CI zip). fetch is stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { API_BASE, ApiError, api, apiFetch, apiFetchBlob } from "./api";

const calls: { url: string; init: RequestInit }[] = [];
function stubFetch(reply: () => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  });
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

describe("apiFetch (unchanged behaviour)", () => {
  it("returns JSON, undefined for 204, and only declares a JSON body when one is sent", async () => {
    stubFetch(() => json({ ok: 1 }));
    expect(await api.get("/x")).toEqual({ ok: 1 });
    expect(calls[0]!.url).toBe(`${API_BASE}/x`);
    expect(calls[0]!.init.headers).toEqual({});
    await api.post("/y", { a: 1 });
    expect(calls[1]!.init).toMatchObject({ method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await apiFetch("/z")).toBeUndefined();
  });

  it("maps the error envelope and network failures to ApiError", async () => {
    stubFetch(() => json({ error: { code: "ci_file_conflict", message: "conflict", details: { paths: ["a"] } } }, 409));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 409, code: "ci_file_conflict", message: "conflict", details: { paths: ["a"] } });
    stubFetch(() => new Response("oops", { status: 500, statusText: "Internal Server Error" }));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 500, message: "500 Internal Server Error" });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(api.get("/x")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("apiFetchBlob / api.postBlob", () => {
  it("returns the binary body as a Blob, sending the JSON body like api.post", async () => {
    stubFetch(() => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200, headers: { "content-type": "application/zip" } }));
    const blob = await api.postBlob("/agents/a/export-ci/zip", { repo: "acme/x" });
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("application/zip");
    expect(calls[0]!.url).toBe(`${API_BASE}/agents/a/export-ci/zip`);
    expect(calls[0]!.init).toMatchObject({ method: "POST", body: '{"repo":"acme/x"}', headers: { "content-type": "application/json" } });
  });

  it("raises the same ApiError for an error envelope and for a network failure", async () => {
    stubFetch(() => json({ error: { code: "ci_repo_has_agent", message: "taken", details: { agent_name: "Perf" } } }, 409));
    const err = await apiFetchBlob("/z", { method: "POST" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "ci_repo_has_agent", details: { agent_name: "Perf" } });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(apiFetchBlob("/z")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});
