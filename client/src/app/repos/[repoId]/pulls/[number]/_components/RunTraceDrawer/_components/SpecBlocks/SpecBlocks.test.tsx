import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PromptAssembly } from "@devdigest/shared";
import runsMessages from "../../../../../../../../../../messages/en/runs.json";
import { SpecBlocks } from "./SpecBlocks";

afterEach(cleanup);

const PLACEHOLDER = "[project context: 1 doc, 120 tokens - text not stored]";
const BASE: PromptAssembly = { system: "S", user: "U" };

function renderIt(assembly: PromptAssembly) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages }}>
      <SpecBlocks assembly={assembly} />
    </NextIntlClientProvider>,
  );
}

describe("SpecBlocks (trace)", () => {
  it("AC-CTX-37 rows path/status/reason/tokens/truncated + summary; specs block shows placeholders", () => {
    renderIt({
      ...BASE,
      specs: PLACEHOLDER,
      specs_tokens: 321,
      spec_blocks: [
        { path: "docs/spec.md", source: "agent", status: "read", tokens: 120, truncated: true },
        { path: "docs/gone.md", source: "skill", skill_id: "s1", status: "missing", reason: "file missing" },
        { path: "docs/big.md", source: "agent", status: "skipped", reason: "budget exhausted" },
      ],
      spec_summary: {
        attached: 3,
        read: 1,
        missing: 1,
        skipped: 1,
        truncated: 1,
        tokens: 120,
        limits: { doc_bytes: 32768, doc_tokens: 4000, prompt_tokens: 12000, attachments: 10 },
      },
    });
    const section = screen.getByTestId("trace-spec-blocks");
    expect(screen.getByTestId("trace-spec-summary")).toHaveTextContent("1 of 3 read · 1 missing · 1 skipped · 1 truncated");
    expect(screen.getByTestId("trace-spec-tokens")).toHaveTextContent("321 tokens");
    const rows = within(screen.getByRole("list", { name: runsMessages.trace.specBlocks.listLabel })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("docs/spec.md");
    expect(rows[0]).toHaveTextContent("read");
    expect(rows[0]).toHaveTextContent(runsMessages.trace.specBlocks.truncated);
    expect(rows[0]).toHaveTextContent("120 tok");
    expect(rows[1]).toHaveTextContent("docs/gone.md");
    expect(rows[1]).toHaveTextContent("skill");
    expect(rows[1]).toHaveTextContent("missing");
    expect(rows[1]).toHaveTextContent("file missing");
    expect(rows[2]).toHaveTextContent("budget exhausted");
    expect(section).toHaveTextContent("4000 tokens per doc");
    expect(section).toHaveTextContent(runsMessages.trace.specBlocks.sent);
    // The block is collapsed until its label is clicked.
    fireEvent.click(screen.getByText(runsMessages.trace.specBlocks.sent));
    expect(section).toHaveTextContent(PLACEHOLDER);
  });

  it("AC-CTX-37 an old trace without spec fields shows the section text only", () => {
    renderIt({ ...BASE, specs: "old specs text" });
    expect(screen.queryByTestId("trace-spec-blocks")).toBeNull();
    expect(screen.getByText(runsMessages.trace.prompt.specs)).toBeInTheDocument();
  });

  it("AC-CTX-37 renders nothing without specs or spec fields", () => {
    const { container } = renderIt(BASE);
    expect(container).toBeEmptyDOMElement();
  });
});
