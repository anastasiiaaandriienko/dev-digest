/**
 * DeleteAgentModal (HW2 #34): names the agent and its skill links, Cancel /
 * Delete / X, a loading state that cannot be dismissed, and a failed delete
 * that keeps the dialog open with the reason. The delete hook is mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { ApiError } from "@/lib/api";
import messages from "../../../../../messages/en/agents.json";

const mutateAsync = vi.fn();
let isPending = false;
vi.mock("@/lib/hooks/agents", () => ({ useDeleteAgent: () => ({ mutateAsync, isPending }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { DeleteAgentModal } from "./DeleteAgentModal";

const D = messages.delete;
const AGENT = { id: "ag1", name: "API Contract Reviewer", skill_count: 4 };

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
  isPending = false;
});

function renderModal(agent: { id: string; name: string; skill_count?: number } = AGENT) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <DeleteAgentModal agent={agent} onClose={onClose} onDeleted={onDeleted} />
    </NextIntlClientProvider>,
  );
  return { onClose, onDeleted };
}

describe("DeleteAgentModal", () => {
  it("names the agent and says what goes with it", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(D.title);
    expect(dialog).toHaveTextContent("Delete “API Contract Reviewer”, its config history and its skill links?");
    expect(screen.getByTestId("delete-agent-skills")).toHaveTextContent("4 skill links are removed. The skills themselves are kept.");
    expect(dialog).toHaveTextContent(D.irreversible);
  });

  it("singular / none / unknown skill counts", () => {
    renderModal({ ...AGENT, skill_count: 1 });
    expect(screen.getByTestId("delete-agent-skills")).toHaveTextContent("1 skill link is removed. The skill itself is kept.");
    cleanup();
    renderModal({ ...AGENT, skill_count: 0 });
    expect(screen.getByTestId("delete-agent-skills")).toHaveTextContent("No skills are attached.");
    cleanup();
    renderModal({ id: "x", name: "No count" });
    expect(screen.queryByTestId("delete-agent-skills")).toBeNull();
  });

  it("Delete calls the API, toasts, reports and closes", async () => {
    mutateAsync.mockResolvedValue({ ok: true });
    const { onClose, onDeleted } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.confirm }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledWith("ag1");
    expect(onDeleted).toHaveBeenCalledWith("ag1");
    expect(success).toHaveBeenCalledWith("Deleted agent “API Contract Reviewer”.");
  });

  it("an API error keeps the dialog open and shows why", async () => {
    mutateAsync.mockRejectedValue(new ApiError("Agent not found", 404, "not_found"));
    const { onClose, onDeleted } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${D.failed} Agent not found`);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("an error without a message shows the reason once", async () => {
    mutateAsync.mockRejectedValue(new Error(""));
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.confirm }));
    expect((await screen.findByRole("alert")).textContent).toBe(D.failed);
  });

  it("Cancel and X close without deleting", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: D.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("while deleting: loading label, Cancel disabled, no X", () => {
    isPending = true;
    renderModal();
    const del = screen.getByRole("button", { name: D.deleting });
    expect(del).toBeDisabled();
    expect(screen.getByRole("button", { name: D.cancel })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
