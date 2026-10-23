/**
 * "Add to eval set" modal (L06, spec §7, §12.1): label from the decision,
 * assertion + expected output, name/notes validation by the contract rules,
 * success closes, documented API errors stay inline, 409 eval_case_exists is
 * treated as "already in the eval set". Hooks and toasts are mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync, isPending: false }),
  existingEvalCaseId: (err: unknown) =>
    err instanceof ApiError && err.code === "eval_case_exists" ? ((err.details as { eval_case_id: string }).eval_case_id ?? null) : null,
}));
const success = vi.fn();
const info = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), info: (m: string) => info(m), error: vi.fn() } }));

import { AddToEvalModal } from "./AddToEvalModal";

const M = messages.finding.evalCase;

const ACCEPTED: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "r",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: "2026-10-22T09:00:00.000Z",
  dismissed_at: null,
  eval_case_id: null,
};
const DISMISSED: FindingRecord = { ...ACCEPTED, id: "f2", title: "Unused import", accepted_at: null, dismissed_at: "2026-10-22T09:00:00.000Z" };

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
  info.mockReset();
});

function renderModal(finding: FindingRecord) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <AddToEvalModal finding={finding} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}
const nameInput = () => screen.getByLabelText(M.modal.nameLabel) as HTMLInputElement;
const notesInput = () => screen.getByLabelText(M.modal.notesLabel) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: M.modal.save });

describe("AddToEvalModal", () => {
  it("accepted finding: positive case, must-find assertion, expected JSON and default name", () => {
    renderModal(ACCEPTED);
    expect(screen.getByText(M.modal.positive)).toBeTruthy();
    expect(screen.getByText(/MUST find “Hardcoded Stripe secret key” at src\/config\.ts:11/)).toBeTruthy();
    expect(screen.getByTestId("eval-expected").textContent).toContain('"file": "src/config.ts"');
    expect(nameInput().value).toBe("must-find-hardcoded-stripe-secret-key");
  });

  it("dismissed finding: negative case, must-not assertion, empty expectation", () => {
    renderModal(DISMISSED);
    expect(screen.getByText(M.modal.negative)).toBeTruthy();
    expect(screen.getByText(/MUST NOT comment on src\/config\.ts:11 \(Unused import\)/)).toBeTruthy();
    expect(screen.getByTestId("eval-expected").textContent).toBe(M.modal.expectedEmpty);
    expect(nameInput().value).toBe("no-unused-import");
  });

  it("validates the name and notes by the contract rules and disables Save", () => {
    renderModal(ACCEPTED);
    fireEvent.change(nameInput(), { target: { value: "Bad Name" } });
    expect(screen.getByRole("alert").textContent).toBe(M.validation.nameFormat);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toBe(M.validation.nameRequired);
    fireEvent.change(nameInput(), { target: { value: "ok-name" } });
    fireEvent.change(notesInput(), { target: { value: "n".repeat(501) } });
    expect(screen.getByRole("alert").textContent).toBe(M.validation.notesTooLong);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("saves name + trimmed notes (never a label), toasts and closes", async () => {
    mutateAsync.mockResolvedValue({ id: "case-1" });
    const { onClose } = renderModal(ACCEPTED);
    fireEvent.change(nameInput(), { target: { value: "stripe-key-leak" } });
    fireEvent.change(notesInput(), { target: { value: "  real leak  " } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ findingId: "f1", body: { name: "stripe-key-leak", notes: "real leak" } });
    expect(success).toHaveBeenCalledWith("Added to the eval set as must find.");
  });

  it("treats 409 eval_case_exists as already in the eval set", async () => {
    mutateAsync.mockRejectedValue(new ApiError("exists", 409, "eval_case_exists", { eval_case_id: "c0" }));
    const { onClose } = renderModal(ACCEPTED);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(info).toHaveBeenCalledWith(M.alreadyExists);
  });

  it.each([
    ["duplicate_location", 409],
    ["conflicting_label", 409],
    ["range_too_wide", 422],
    ["location_not_in_diff", 422],
    ["diff_unavailable", 422],
  ] as const)("shows %s inline and keeps the modal open", async (code, status) => {
    mutateAsync.mockRejectedValue(new ApiError("server text", status, code));
    const { onClose } = renderModal(DISMISSED);
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("eval-case-error").textContent).toBe(M.errors[code]));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for unknown errors", async () => {
    mutateAsync.mockRejectedValue(new Error("boom"));
    renderModal(ACCEPTED);
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByTestId("eval-case-error").textContent).toBe(M.errors.generic));
  });
});
