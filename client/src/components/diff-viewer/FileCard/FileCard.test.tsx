import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import type { FindingRecord, PrReviewComment } from "@devdigest/shared";
import { finding, prFile, renderIntl } from "../../../test/diff-fixtures";
import type { DiffFindingsApi } from "../findings";
import type { DiffCommentApi } from "../comments";
import { FileCard } from "./FileCard";
import { DiffViewer } from "../DiffViewer";

afterEach(cleanup);

function api(items: FindingRecord[], visible = true): DiffFindingsApi {
  return {
    items,
    visible,
    renderCard: (f) => <div data-testid={`card-${f.id}`}>{`card ${f.id}`}</div>,
  };
}

const COMMENT: PrReviewComment = {
  id: 1,
  path: "src/a.ts",
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

function commenting(showComments: boolean): DiffCommentApi {
  return {
    comments: [COMMENT],
    canComment: false,
    showComments,
    posting: false,
    onSubmit: vi.fn(async () => undefined),
  };
}

describe("FileCard with findings", () => {
  it("shows one card per finding under its line, after the GitHub thread", () => {
    renderIntl(
      <FileCard
        file={prFile("src/a.ts")}
        commenting={commenting(true)}
        findings={api([
          finding({ id: "f1", review_id: "rA" }),
          finding({ id: "f2", review_id: "rB" }),
          finding({ id: "other", file: "src/b.ts" }),
        ])}
      />,
    );
    expect(screen.getByTestId("card-f1")).toBeInTheDocument();
    expect(screen.getByTestId("card-f2")).toBeInTheDocument();
    expect(screen.queryByTestId("card-other")).not.toBeInTheDocument();
    const thread = screen.getByText("gh thread body");
    const card = screen.getByTestId("card-f1");
    expect(thread.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("file-finding-dot")).toBeInTheDocument();
  });

  it("hides cards and the dot when visible=false while threads follow only the comments toggle (and vice versa)", () => {
    const items = [finding({ id: "f1" })];
    renderIntl(
      <FileCard file={prFile("src/a.ts")} commenting={commenting(true)} findings={api(items, false)} />,
    );
    expect(screen.queryByTestId("card-f1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-finding-dot")).not.toBeInTheDocument();
    expect(screen.getByText("gh thread body")).toBeInTheDocument();
    cleanup();
    renderIntl(<FileCard file={prFile("src/a.ts")} commenting={commenting(false)} findings={api(items, true)} />);
    expect(screen.getByTestId("card-f1")).toBeInTheDocument();
    expect(screen.queryByText("gh thread body")).not.toBeInTheDocument();
  });

  it("renders findings without a rendered new-side line in the unanchored block", () => {
    renderIntl(
      <FileCard
        file={prFile("src/a.ts")}
        findings={api([finding({ id: "far", start_line: 90, end_line: 95 })])}
      />,
    );
    expect(screen.getByText("Findings not on changed lines")).toBeInTheDocument();
    expect(screen.getByTestId("card-far")).toBeInTheDocument();
  });

  it("omits the unanchored block when visible=false", () => {
    renderIntl(
      <FileCard
        file={prFile("src/a.ts")}
        findings={api([finding({ id: "far", start_line: 90, end_line: 95 })], false)}
      />,
    );
    expect(screen.queryByText("Findings not on changed lines")).not.toBeInTheDocument();
  });

  it("auto-opens a large file that has findings, and the user can collapse it", () => {
    const big = prFile("src/a.ts", { additions: 500, deletions: 10 });
    renderIntl(<FileCard file={big} findings={api([finding({ id: "f1" })])} />);
    expect(screen.getByTestId("card-f1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(screen.queryByTestId("card-f1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(screen.getByTestId("card-f1")).toBeInTheDocument();
  });

  it("keeps the <=200-line rule: 201 changed lines without findings start collapsed, 200 open", () => {
    renderIntl(<FileCard file={prFile("big.ts", { additions: 201, deletions: 0 })} findings={api([])} />);
    expect(screen.queryByText("added two")).not.toBeInTheDocument();
    cleanup();
    renderIntl(<FileCard file={prFile("edge.ts", { additions: 150, deletions: 50 })} findings={api([])} />);
    expect(screen.getByText("added two")).toBeInTheDocument();
  });
});

describe("without the findings prop (Original behaviour)", () => {
  it("FileCard renders lines with no dot, cards or unanchored block", () => {
    renderIntl(<FileCard file={prFile("src/a.ts")} />);
    expect(screen.getByText("added two")).toBeInTheDocument();
    expect(screen.queryByTestId("file-finding-dot")).not.toBeInTheDocument();
    expect(screen.queryByText("Findings not on changed lines")).not.toBeInTheDocument();
  });

  it("a large file stays collapsed", () => {
    renderIntl(<FileCard file={prFile("big.ts", { additions: 900, deletions: 0 })} />);
    expect(screen.queryByText("added two")).not.toBeInTheDocument();
  });

  it("DiffViewer renders every file, or the empty message", () => {
    renderIntl(<DiffViewer files={[prFile("a.ts"), prFile("b.ts")]} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    cleanup();
    renderIntl(<DiffViewer files={[]} />);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("DiffViewer passes findings down to its file cards", () => {
    renderIntl(<DiffViewer files={[prFile("src/a.ts")]} findings={api([finding({ id: "f1" })])} />);
    expect(screen.getByTestId("card-f1")).toBeInTheDocument();
  });
});
