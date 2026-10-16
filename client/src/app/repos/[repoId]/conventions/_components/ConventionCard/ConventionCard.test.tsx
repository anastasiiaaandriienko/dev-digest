import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { ConventionCard } from "./ConventionCard";

afterEach(() => {
  cleanup();
  success.mockReset();
});

const C = messages.card;
const CAND: ConventionCandidate = {
  id: "c1",
  repo_id: "r",
  rule: "Throw AppError for invalid input",
  category: "error_handling",
  evidence_path: "src/users.ts",
  evidence_line: 5,
  evidence_snippet: "if (!id) throw new AppError('missing id');",
  confidence: 0.72,
  status: "pending",
  accepted: false,
  scan_id: "s",
  created_at: "2026-10-15T10:00:00.000Z",
  updated_at: "2026-10-15T10:00:00.000Z",
};

function renderCard(c: Partial<ConventionCandidate> = {}, onUpdate = vi.fn().mockResolvedValue(undefined)) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ul>
        <ConventionCard candidate={{ ...CAND, ...c }} onUpdate={onUpdate} />
      </ul>
    </NextIntlClientProvider>,
  );
  return onUpdate;
}

describe("ConventionCard — display (HW2 #46)", () => {
  it("shows the rule, category, file:line, the snippet and the confidence percentage", () => {
    renderCard();
    expect(screen.getByText("Throw AppError for invalid input")).toBeInTheDocument();
    expect(screen.getByTestId("convention-category")).toHaveTextContent("error handling");
    expect(screen.getByText("src/users.ts:5")).toBeInTheDocument();
    expect(screen.getByTestId("convention-snippet")).toHaveTextContent("throw new AppError('missing id');");
    expect(screen.getByTestId("convention-confidence")).toHaveTextContent("72%");
  });

  it("file:line is a link only when an evidence URL is given", () => {
    renderCard();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ul>
          <ConventionCard candidate={CAND} evidenceHref="https://github.com/acme/api/blob/c0ffee1/src/users.ts#L5" onUpdate={vi.fn()} />
        </ul>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: "src/users.ts:5" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/c0ffee1/src/users.ts#L5",
    );
  });

  it("legacy candidates without evidence or confidence still render", () => {
    renderCard({ evidence_path: null, evidence_line: null, evidence_snippet: null, confidence: null, category: "other" });
    expect(screen.getByText(C.noEvidence)).toBeInTheDocument();
    expect(screen.getByTestId("convention-confidence")).toHaveTextContent("—");
    expect(screen.queryByTestId("convention-snippet")).toBeNull();
  });

  it("copies file:line", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Copy src/users.ts:5" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("src/users.ts:5"));
    expect(success).toHaveBeenCalledWith("Copied src/users.ts:5");
  });
});

describe("ConventionCard — Accept / Reject (HW2 #47)", () => {
  it("Accept → accepted; on an accepted card the button undoes it", () => {
    const onUpdate = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^Accept: / }));
    expect(onUpdate).toHaveBeenCalledWith({ status: "accepted" });
    cleanup();
    const again = renderCard({ status: "accepted", accepted: true });
    const btn = screen.getByRole("button", { name: /^Undo accept: / });
    expect(btn).toHaveTextContent(C.accepted);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(again).toHaveBeenCalledWith({ status: "pending" });
  });

  it("Reject → rejected", () => {
    const onUpdate = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /^Reject: / }));
    expect(onUpdate).toHaveBeenCalledWith({ status: "rejected" });
  });

  it("a refused decision does not throw out of the click", async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error("500"));
    renderCard({}, onUpdate);
    fireEvent.click(screen.getByRole("button", { name: /^Reject: / }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });
});

describe("ConventionCard — inline edit (HW2 #49)", () => {
  const openEditor = () => fireEvent.click(screen.getByRole("button", { name: /^Edit: / }));

  it("edits rule + category in place and saves them", async () => {
    const onUpdate = renderCard();
    openEditor();
    expect(screen.queryByRole("button", { name: /^Accept: / })).toBeNull(); // actions hidden while editing
    fireEvent.change(screen.getByLabelText(C.ruleLabel), { target: { value: "  Throw AppError, never plain Error  " } });
    fireEvent.change(screen.getByLabelText(C.categoryLabel), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: C.save }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ rule: "Throw AppError, never plain Error", category: "api" }));
    await waitFor(() => expect(screen.queryByLabelText(C.ruleLabel)).toBeNull());
  });

  it("invalid text is refused before any request", () => {
    const onUpdate = renderCard();
    openEditor();
    fireEvent.change(screen.getByLabelText(C.ruleLabel), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: C.save }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(C.ruleLabel), { target: { value: '<img src=x onerror="alert(1)">' } });
    fireEvent.click(screen.getByRole("button", { name: C.save }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Executable content is not allowed/);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Cancel discards; a failed save keeps the editor and the text", async () => {
    renderCard();
    openEditor();
    fireEvent.change(screen.getByLabelText(C.ruleLabel), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: C.cancel }));
    expect(screen.getByText("Throw AppError for invalid input")).toBeInTheDocument();
    cleanup();

    const onUpdate = vi.fn().mockRejectedValue(new Error("409"));
    renderCard({}, onUpdate);
    openEditor();
    fireEvent.change(screen.getByLabelText(C.ruleLabel), { target: { value: "Keep this text" } });
    fireEvent.click(screen.getByRole("button", { name: C.save }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(screen.getByLabelText(C.ruleLabel)).toHaveValue("Keep this text");
  });
});
