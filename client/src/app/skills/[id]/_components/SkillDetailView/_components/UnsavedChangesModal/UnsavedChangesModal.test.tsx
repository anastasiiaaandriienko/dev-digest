/**
 * UnsavedChangesModal: names the skill, the three choices call their handlers,
 * and while the save runs nothing can dismiss it (no X, buttons disabled).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/skills.json";
import { UnsavedChangesModal } from "./UnsavedChangesModal";

const U = messages.unsaved;
afterEach(cleanup);

function renderModal(saving = false) {
  const h = { onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <UnsavedChangesModal name="breaking-change" saving={saving} {...h} />
    </NextIntlClientProvider>,
  );
  return h;
}

describe("UnsavedChangesModal", () => {
  it("names the skill; Save and continue / Discard changes / Cancel / X call their handlers", () => {
    const h = renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent("“breaking-change” has changes that aren’t saved yet.");
    fireEvent.click(screen.getByRole("button", { name: U.save }));
    fireEvent.click(screen.getByRole("button", { name: U.discard }));
    fireEvent.click(screen.getByRole("button", { name: U.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    expect(h.onCancel).toHaveBeenCalledTimes(2);
  });

  it("while saving: shows progress and cannot be dismissed", () => {
    const h = renderModal(true);
    expect(screen.getByRole("button", { name: U.saving })).toBeDisabled();
    expect(screen.getByRole("button", { name: U.discard })).toBeDisabled();
    expect(screen.getByRole("button", { name: U.cancel })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(h.onCancel).not.toHaveBeenCalled();
  });
});
