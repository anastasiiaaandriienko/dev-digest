/** Skill import hooks (HW2 #15) against a real QueryClient with the HTTP layer mocked. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const post = vi.fn();
vi.mock("../api", () => ({ api: { post: (...a: unknown[]) => post(...a) }, API_BASE: "" }));

import { SKILLS_KEY, useImportSkills, usePreviewSkillImport } from "./skills";

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  post.mockReset();
});

describe("skill import hooks", () => {
  it("preview POSTs the file and touches no cache", async () => {
    post.mockResolvedValue({ items: [] });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePreviewSkillImport(), { wrapper });
    await act(() => result.current.mutateAsync({ filename: "a.md", content_base64: "IyB4" }));
    expect(post).toHaveBeenCalledWith("/skills/import/preview", { filename: "a.md", content_base64: "IyB4" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("import POSTs { items } and refreshes the skills list", async () => {
    post.mockResolvedValue([]);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const items = [{ name: "a", description: "", type: "custom" as const, body: "# a" }];
    const { result } = renderHook(() => useImportSkills(), { wrapper });
    await act(() => result.current.mutateAsync(items));
    expect(post).toHaveBeenCalledWith("/skills/import", { items });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SKILLS_KEY });
  });
});
