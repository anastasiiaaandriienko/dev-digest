import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/skills.json";

const mutateAsync = vi.fn();
let isPending = false;
vi.mock("@/lib/hooks/skills", () => ({ useDeleteSkill: () => ({ mutateAsync, isPending }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { DeleteSkillModal } from "./DeleteSkillModal";

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
  isPending = false;
});

const D = messages.delete;

function renderModal(agent_count = 2) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <DeleteSkillModal skill={{ id: "s1", name: "breaking-change", agent_count }} onClose={onClose} onDeleted={onDeleted} />
    </NextIntlClientProvider>,
  );
  return { onClose, onDeleted };
}

describe("DeleteSkillModal", () => {
  it("names the skill and how many agents lose it (agents are kept)", () => {
    renderModal(2);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(D.title);
    expect(dialog).toHaveTextContent("Delete “breaking-change” and its whole version history?");
    expect(screen.getByTestId("delete-skill-usage")).toHaveTextContent(
      "It will be removed from 2 agents. The agents themselves are kept.",
    );
    expect(dialog).toHaveTextContent(D.irreversible);
  });

  it("singular and zero agent counts", () => {
    renderModal(1);
    expect(screen.getByTestId("delete-skill-usage")).toHaveTextContent("removed from 1 agent. The agent itself is kept.");
    cleanup();
    renderModal(0);
    expect(screen.getByTestId("delete-skill-usage")).toHaveTextContent("No agent uses it.");
  });

  it("Cancel and the X close without deleting", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("Delete calls the API once, toasts, reports the id and closes", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    const { onClose, onDeleted } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.confirm }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith("s1");
    expect(onDeleted).toHaveBeenCalledWith("s1");
    expect(success).toHaveBeenCalledWith("Deleted skill “breaking-change”.");
  });

  it("a failed delete keeps the dialog open", async () => {
    mutateAsync.mockRejectedValue(new Error("500"));
    const { onClose, onDeleted } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.confirm }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("while deleting, both buttons are disabled and the X is hidden", () => {
    isPending = true;
    renderModal();
    expect(screen.getByRole("button", { name: D.deleting })).toBeDisabled();
    expect(screen.getByRole("button", { name: D.cancel })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});
