import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { IntentContextSource } from "@devdigest/shared";
import messages from "../../../../../../../../../../../../messages/en/intent.json";
import { ContextSources } from "./ContextSources";
import { contextGaps, listedSources } from "./helpers";

function renderSources(sources: IntentContextSource[] | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ intent: messages }}>
      <ContextSources sources={sources} />
    </NextIntlClientProvider>,
  );
}

const SOURCES: IntentContextSource[] = [
  { kind: "pr_title", status: "confirmed", ref: "title" },
  { kind: "pr_description", status: "confirmed", ref: "description" },
  { kind: "linked_issue", status: "confirmed", ref: "#12", title: "Retry webhooks" },
  { kind: "linked_issue", status: "unavailable", ref: "#13", note: "not_found_or_no_access" },
  { kind: "ticket_link", status: "unverified", ref: "https://linear.app/acme/issue/ENG-1", note: "not_fetched" },
  { kind: "plan_doc", status: "confirmed", ref: "docs/plans/retry.md", note: "truncated" },
];

afterEach(cleanup);

describe("ContextSources", () => {
  it("lists each non-trivial source with its status and note; PR title/description are implied", () => {
    renderSources(SOURCES);
    const items = screen.getAllByRole("listitem").filter((li) => li.closest("ul")?.getAttribute("aria-label") !== "Missing context");
    expect(items).toHaveLength(4);
    expect(within(items[0]!).getByText("#12")).toBeTruthy();
    expect(within(items[0]!).getByText("Retry webhooks")).toBeTruthy();
    expect(within(items[0]!).getByText("Confirmed")).toBeTruthy();
    expect(within(items[1]!).getByText("Unavailable")).toBeTruthy();
    expect(within(items[1]!).getByText("not found or no access")).toBeTruthy();
    expect(within(items[2]!).getByText("Not verified")).toBeTruthy();
    expect(within(items[2]!).getByText("not fetched — content unknown")).toBeTruthy();
    expect(within(items[3]!).getByText("shortened to fit the prompt")).toBeTruthy();
    expect(screen.queryByText("PR title")).toBeNull();
  });

  it("renders untrusted refs as plain text, never as links", () => {
    const { container } = renderSources([
      { kind: "link", status: "unverified", ref: "javascript:alert(1)", note: "not_fetched" },
      { kind: "linked_issue", status: "confirmed", ref: "#1", title: "<img src=x onerror=alert(1)>" },
    ]);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  });

  it("shows what was missing", () => {
    renderSources(SOURCES);
    const gaps = screen.getByRole("list", { name: "Missing context" });
    expect(within(gaps).getByText(/1 source could not be loaded/)).toBeTruthy();
    expect(within(gaps).getByText(/1 reference was not verified/)).toBeTruthy();
    expect(within(gaps).queryByText(/No linked issue/)).toBeNull();
  });

  it("says when only the PR itself was available, with the empty description called out", () => {
    renderSources([
      { kind: "pr_title", status: "confirmed", ref: "title" },
      { kind: "pr_description", status: "missing", ref: "description", note: "empty" },
    ]);
    expect(screen.getByText("PR description")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
    expect(screen.getByText("The PR description is empty.")).toBeTruthy();
    expect(screen.getByText("No linked issue was referenced in the description.")).toBeTruthy();
    expect(screen.getByText("No planning document or plan link was found.")).toBeTruthy();
  });

  it("explains that older intents have no recorded sources", () => {
    renderSources(null);
    expect(screen.getByText(/were not recorded for this intent/)).toBeTruthy();
  });
});

describe("context helpers", () => {
  it("contextGaps derives gaps only from recorded sources", () => {
    expect(contextGaps(SOURCES)).toEqual([
      { key: "issuesUnavailable", count: 1 },
      { key: "unverified", count: 1 },
    ]);
    expect(contextGaps([]).map((g) => g.key)).toEqual(["noLinkedIssues", "noPlanDocs"]);
  });

  it("listedSources hides confirmed PR title/description only", () => {
    expect(listedSources(SOURCES).map((x) => x.ref)).toEqual(["#12", "#13", "https://linear.app/acme/issue/ENG-1", "docs/plans/retry.md"]);
  });
});
