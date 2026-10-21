import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { PrReviewComment } from "@devdigest/shared";
import { finding, prFile, renderIntl } from "../../../../../../../test/diff-fixtures";

const createMutate = vi.fn();
const actionMutate = vi.fn();
let comments: PrReviewComment[] = [];
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: comments }),
  useCreatePrComment: () => ({ mutateAsync: createMutate, mutate: createMutate, isPending: false }),
  useFindingAction: () => ({ mutate: actionMutate, isPending: false }),
  useFindingDecisionStatus: () => new Map(),
}));

import { DiffTab } from "./DiffTab";

const COMMENT: PrReviewComment = {
  id: 1,
  path: "src/core.ts",
  line: 2,
  original_line: 2,
  side: "RIGHT",
  body: "gh thread body",
  user: "octo",
  created_at: "2026-10-01T00:00:00Z",
  html_url: "https://example.test/c/1",
  in_reply_to_id: null,
  is_outdated: false,
};

const FILES = [prFile("src/core.ts"), prFile("src/core.test.ts"), prFile("README.md"), prFile("docs/guide.md")];

const KEYS = ["core", "tests", "wiring", "docs", "boilerplate"] as const;

const spyFetch = () => vi.spyOn(globalThis, "fetch");
let fetchSpy: ReturnType<typeof spyFetch>;
beforeEach(() => {
  comments = [];
  createMutate.mockClear();
  actionMutate.mockClear();
  fetchSpy = spyFetch();
});
afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
});

function groupEl(key: string) {
  return screen.getByTestId(`smart-group-${key}`);
}

describe("DiffTab", () => {
  it("defaults to Original order (no groups) and keeps the 'Files changed · N files' heading", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} />);
    expect(screen.getByText(/Files changed · 4 files/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("smart-group-core")).not.toBeInTheDocument();
    expect(screen.getByText("src/core.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /findings/i })).not.toBeInTheDocument();
  });

  it("Smart order lists all five groups in order, with empty ones disabled at 0 files", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} />);
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    const rendered = screen.getAllByTestId(/^smart-group-/).map((el) => el.getAttribute("data-testid"));
    expect(rendered).toEqual(KEYS.map((k) => `smart-group-${k}`));
    for (const k of ["wiring", "boilerplate"]) {
      expect(within(groupEl(k)).getByRole("button")).toBeDisabled();
      expect(within(groupEl(k)).getByText("0 files")).toBeInTheDocument();
    }
    expect(within(groupEl("tests")).getByText("1 files")).toBeInTheDocument();
    expect(within(groupEl("docs")).getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText(/Smart Diff · grouped by role/)).toBeInTheDocument();
  });

  it("expands core/tests by default, collapses docs without findings; user can toggle", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} />);
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(within(groupEl("core")).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(groupEl("tests")).getByRole("button", { expanded: true })).toBeInTheDocument();
    const docsHeader = within(groupEl("docs")).getByRole("button");
    expect(docsHeader).toHaveAttribute("aria-expanded", "false");
    expect(within(groupEl("docs")).queryByText("README.md")).not.toBeInTheDocument();

    fireEvent.click(docsHeader);
    expect(docsHeader).toHaveAttribute("aria-expanded", "true");
    expect(within(groupEl("docs")).getByText("README.md")).toBeInTheDocument();

    fireEvent.click(within(groupEl("core")).getAllByRole("button")[0]!);
    expect(within(groupEl("core")).queryByText("src/core.ts")).not.toBeInTheDocument();
  });

  it("expands docs by default when it has findings and counts FILES, not findings", () => {
    const findings = [
      finding({ id: "d1", file: "README.md" }),
      finding({ id: "d2", file: "README.md", start_line: 3, end_line: 3 }),
    ];
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={findings} />);
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    const docs = groupEl("docs");
    expect(within(docs).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(docs).getByTitle("1 file with findings")).toHaveTextContent(/^1$/);
    expect(within(groupEl("core")).queryByTitle(/with findings/)).not.toBeInTheDocument();
  });

  it("Hide findings is independent of the comments toggle and nothing sends a request", () => {
    comments = [COMMENT];
    const findings = [
      finding({ id: "f1", file: "src/core.ts", review_id: "rA", title: "Alpha issue" }),
      finding({ id: "f2", file: "src/core.ts", review_id: "rB", title: "Beta issue" }),
    ];
    renderIntl(
      <DiffTab
        prId="pr1"
        filesCount={4}
        files={FILES}
        findings={findings}
        agentNames={{ rA: "Agent A", rB: "Agent B" }}
      />,
    );
    expect(screen.getByText("Alpha issue")).toBeInTheDocument();
    expect(screen.getByText("Beta issue")).toBeInTheDocument();
    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getByText("Agent B")).toBeInTheDocument();
    expect(screen.getByTestId("file-finding-dot")).toBeInTheDocument();
    expect(screen.queryByText("gh thread body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide findings (2)" }));
    expect(screen.queryByText("Alpha issue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-finding-dot")).not.toBeInTheDocument();
    expect(screen.queryByText("gh thread body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show comments (1)" }));
    expect(screen.getByText("gh thread body")).toBeInTheDocument();
    expect(screen.queryByText("Alpha issue")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show findings (2)" }));
    expect(screen.getByText("Alpha issue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments (1)" }));
    expect(screen.queryByText("gh thread body")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha issue")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
    expect(actionMutate).not.toHaveBeenCalled();
  });

  describe("findings on files outside the diff", () => {
    const TITLE = "Findings on files outside this diff";
    const OUT = finding({ id: "o1", file: "src/gone.ts", title: "Outside issue" });
    const IN = finding({ id: "i1", file: "src/core.ts", title: "Inside issue" });

    it.each(["Original order", "Smart order"])("renders them in a titled block in %s", (mode) => {
      renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={[OUT, IN]} />);
      fireEvent.click(screen.getByRole("button", { name: mode }));
      const title = screen.getByText(TITLE);
      const block = title.parentElement as HTMLElement;
      expect(within(block).getByText("Outside issue")).toBeInTheDocument();
      expect(screen.getAllByText("Outside issue")).toHaveLength(1);
    });

    it("does not duplicate in-diff findings into the block", () => {
      renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={[OUT, IN]} />);
      const block = screen.getByText(TITLE).parentElement as HTMLElement;
      expect(within(block).queryByText("Inside issue")).not.toBeInTheDocument();
      expect(screen.getAllByText("Inside issue")).toHaveLength(1);
    });

    it("counter equals all findings and the block hides with them", () => {
      renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={[OUT, IN]} />);
      fireEvent.click(screen.getByRole("button", { name: "Hide findings (2)" }));
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
      expect(screen.queryByText("Outside issue")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show findings (2)" }));
      expect(screen.getByText(TITLE)).toBeInTheDocument();
    });

    it("is absent when every finding is on a diff file", () => {
      renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={[IN]} />);
      expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    });
  });

  it("shows findings inside Smart groups too, a dismissed one muted", () => {
    const findings = [
      finding({ id: "t1", file: "src/core.test.ts", title: "Test gap", dismissed_at: "2026-10-01T00:00:00Z" }),
    ];
    const { container } = renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} findings={findings} />);
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(within(groupEl("tests")).getByText("Test gap")).toBeInTheDocument();
    expect(container.querySelector("[data-finding-id='t1']")).toHaveStyle({ opacity: "0.6" });
  });
});

describe("DiffTab deep link (focus file + line)", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
  const BIG = [prFile("src/big.ts", { additions: 900 }), ...FILES];

  it("AC-BRIEF-36 opens and scrolls the focused file", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={5} files={BIG} focusFile="src/big.ts" focusLine={2} />);
    // The 900-line file would stay collapsed; focus forces it open and scrolls to its card.
    expect(screen.getAllByText("added two").length).toBeGreaterThan(0);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const card = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(card).toHaveTextContent("src/big.ts");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("AC-BRIEF-36 opens the Smart group holding the focused file", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} focusFile="README.md" focusLine={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(within(groupEl("docs")).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(within(groupEl("docs")).getByText("README.md")).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("AC-BRIEF-37 notice for missing file", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} focusFile="src/gone.ts" focusLine={5} />);
    expect(screen.getByRole("status")).toHaveTextContent("src/gone.ts is not part of the loaded diff.");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("AC-BRIEF-37 notice for line not in loaded diff", () => {
    renderIntl(<DiffTab prId="pr1" filesCount={4} files={FILES} focusFile="src/core.ts" focusLine={99} />);
    expect(screen.getByRole("status")).toHaveTextContent("Line 99 of src/core.ts is not in the loaded diff");
    // The file itself still opens and scrolls.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    cleanup();
    renderIntl(
      <DiffTab prId="pr1" filesCount={1} files={[prFile("src/nopatch.ts", { patch: null })]} focusFile="src/nopatch.ts" focusLine={3} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Line 3 of src/nopatch.ts");
  });
});
