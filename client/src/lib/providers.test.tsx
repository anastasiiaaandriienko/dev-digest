/** Global MutationCache error toast: on by default, off with `meta: { silent: true }`. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MutationObserver } from "@tanstack/react-query";

const error = vi.fn();
vi.mock("./toast", () => ({
  ToastProvider: ({ children }: { children: unknown }) => children,
  notify: { error: (m: string) => error(m) },
}));

import { createQueryClient } from "./providers";

async function failingMutation(meta?: Record<string, unknown>) {
  const qc = createQueryClient();
  const observer = new MutationObserver(qc, {
    mutationFn: () => Promise.reject(new Error("boom")),
    retry: 0,
    meta,
  });
  await observer.mutate().catch(() => undefined);
}

beforeEach(() => error.mockReset());

describe("createQueryClient mutation errors", () => {
  it("toasts a mutation error by default", async () => {
    await failingMutation();
    expect(error).toHaveBeenCalledWith("boom");
  });

  it("does not toast when the mutation is marked silent", async () => {
    await failingMutation({ silent: true });
    expect(error).not.toHaveBeenCalled();
  });
});
