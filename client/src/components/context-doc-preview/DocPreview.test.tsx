/** DocPreview: default body keeps the 520px cap; `fill` (page layout) removes it. */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";

vi.mock("@/lib/hooks/context", () => ({
  useContextFile: (_repoId: string, path: string | null) => ({
    data: path ? { path, content: "# Preview body", truncated: false } : undefined,
    isLoading: false,
    isError: false,
  }),
}));

import { DocPreview } from "./DocPreview";

afterEach(cleanup);

const view = (fill?: boolean) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <DocPreview repoId="r1" path="docs/spec.md" fill={fill} />
    </NextIntlClientProvider>,
  );

const body = () => screen.getByRole("heading", { name: "Preview body" }).parentElement!.parentElement!;

describe("DocPreview", () => {
  it("AC-CTX-146 default body keeps the 520px cap", () => {
    view();
    expect(body().style.maxHeight).toBe("520px");
  });

  it("AC-CTX-146 fill removes the cap and keeps read-only content", () => {
    view(true);
    expect(body().style.maxHeight).toBe("");
    expect(screen.getByRole("heading", { name: "Preview body" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
