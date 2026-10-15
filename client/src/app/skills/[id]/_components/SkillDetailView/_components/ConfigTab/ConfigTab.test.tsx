import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutateAsync = vi.fn();
let isPending = false;
vi.mock("@/lib/hooks/skills", () => ({ useUpdateSkill: () => ({ mutateAsync, isPending }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { ConfigTab } from "./ConfigTab";

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
  isPending = false;
});

const C = messages.detail.config;
const SKILL: Skill = {
  id: "s1",
  name: "breaking-change",
  description: "Flag API removals",
  type: "security",
  source: "manual",
  body: "# Rule\nNo removed fields.",
  enabled: true,
  version: 3,
  evidence_files: null,
  agent_count: 2,
};

function renderTab(skill: Skill = SKILL) {
  const onDelete = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ConfigTab skill={skill} onDelete={onDelete} />
    </NextIntlClientProvider>,
  );
  return { onDelete };
}

const save = () => screen.getByRole("button", { name: C.save });
const inputWith = (value: string) => screen.getByDisplayValue(value) as HTMLInputElement | HTMLTextAreaElement;
// The body is multi-line; Testing Library collapses whitespace when matching values, so find it by role.
const bodyArea = () => document.querySelector("textarea") as HTMLTextAreaElement;

describe("ConfigTab", () => {
  it("shows every editable field filled from the skill, the version and the body stats", () => {
    renderTab();
    expect(inputWith("breaking-change")).toBeInTheDocument();
    expect(inputWith("Flag API removals")).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("security");
    expect(bodyArea().value).toBe("# Rule\nNo removed fields.");
    expect(screen.getByRole("switch", { name: "Enable breaking-change" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByTestId("body-stats")).toHaveTextContent("2 lines · ~7 tokens");
    expect(screen.getByText(/snapshots it as v4/)).toBeInTheDocument();
  });

  it("Save is disabled until something changes", () => {
    renderTab();
    expect(save()).toBeDisabled();
    expect(screen.getByText(C.noChanges)).toBeInTheDocument();
  });

  it("saves only the changed metadata (no body, so no new version)", async () => {
    mutateAsync.mockResolvedValue({ ...SKILL, description: "new", enabled: false });
    renderTab();
    fireEvent.change(inputWith("Flag API removals"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("switch", { name: "Enable breaking-change" }));
    fireEvent.click(save());
    await waitFor(() => expect(success).toHaveBeenCalledWith("Saved “breaking-change”."));
    expect(mutateAsync).toHaveBeenCalledWith({ id: "s1", patch: { description: "new", enabled: false } });
  });

  it("a changed body is saved and reported as the new version", async () => {
    mutateAsync.mockResolvedValue({ ...SKILL, body: "# Rule v4", version: 4 });
    renderTab();
    fireEvent.change(bodyArea(), { target: { value: "# Rule v4" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "rubric" } });
    fireEvent.click(save());
    await waitFor(() => expect(success).toHaveBeenCalledWith("Saved “breaking-change” as v4."));
    expect(mutateAsync).toHaveBeenCalledWith({ id: "s1", patch: { body: "# Rule v4", type: "rubric" } });
  });

  it("invalid fields show inline errors and nothing is sent", () => {
    renderTab();
    fireEvent.change(inputWith("breaking-change"), { target: { value: "  " } });
    fireEvent.change(bodyArea(), { target: { value: "" } });
    fireEvent.click(save());
    expect(screen.getByText(messages.create.errors.name)).toBeInTheDocument();
    expect(screen.getByText(messages.create.errors.body)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("Discard restores the saved values; a failed save keeps the edits", async () => {
    renderTab();
    fireEvent.change(inputWith("Flag API removals"), { target: { value: "draft" } });
    fireEvent.click(screen.getByRole("button", { name: C.reset }));
    expect(inputWith("Flag API removals")).toBeInTheDocument();
    expect(save()).toBeDisabled();

    mutateAsync.mockRejectedValue(new Error("500"));
    fireEvent.change(inputWith("Flag API removals"), { target: { value: "draft" } });
    fireEvent.click(save());
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(inputWith("draft")).toBeInTheDocument();
    expect(success).not.toHaveBeenCalled();
  });

  it("the danger zone asks the parent to delete", () => {
    const { onDelete } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: C.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
