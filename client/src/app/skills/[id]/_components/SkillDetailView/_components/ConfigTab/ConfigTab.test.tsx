import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { act, render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const mutateAsync = vi.fn();
let isPending = false;
vi.mock("@/lib/hooks/skills", () => ({ useUpdateSkill: () => ({ mutateAsync, isPending }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { ConfigTab } from "./ConfigTab";
import type { ConfigGuard } from "./helpers";

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

describe("ConfigTab — body editor (design: code editor)", () => {
  it("shows the file name, line numbers and the token count; 'unsaved' only after a body edit; Cancel restores", () => {
    renderTab();
    const editor = screen.getByTestId("skill-body-editor");
    expect(editor).toHaveTextContent("breaking-change.md");
    expect(screen.getByTestId("body-tokens")).toHaveTextContent("~7 tokens");
    expect(screen.queryByTestId("body-unsaved")).toBeNull();

    const body = screen.getByRole("textbox", { name: C.body });
    fireEvent.change(body, { target: { value: "# Rule\nNo removed fields.\n- new line" } });
    expect(screen.getByTestId("body-unsaved")).toHaveTextContent(C.unsaved);
    expect(editor.textContent).toContain("3"); // a third line number
    expect(screen.getByText(/Saving snapshots the body as/)).toHaveTextContent("v4");

    fireEvent.click(screen.getByRole("button", { name: C.reset }));
    expect((screen.getByRole("textbox", { name: C.body }) as HTMLTextAreaElement).value).toBe(SKILL.body);
    expect(screen.queryByTestId("body-unsaved")).toBeNull();
  });

  it("a metadata-only edit says the body keeps the current version", () => {
    renderTab();
    fireEvent.change(screen.getByDisplayValue("Flag API removals"), { target: { value: "New description" } });
    expect(screen.queryByText(/Saving snapshots the body as/)).toBeNull();
    expect(screen.getByText(/Metadata only/)).toHaveTextContent("the body stays v3");
  });
});

describe("ConfigTab — unsaved-edits guard (switching skills)", () => {
  function renderGuarded() {
    const guardRef: React.MutableRefObject<ConfigGuard | null> = { current: null };
    const r = render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ConfigTab skill={SKILL} onDelete={vi.fn()} guardRef={guardRef} />
      </NextIntlClientProvider>,
    );
    return { guardRef, ...r };
  }

  it("reports dirty only after an edit, and clears itself on unmount", () => {
    const { guardRef, unmount } = renderGuarded();
    expect(guardRef.current?.dirty).toBe(false);
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "breaking-change-v2" } });
    expect(guardRef.current?.dirty).toBe(true);
    unmount();
    expect(guardRef.current).toBeNull();
  });

  it("guard.save(): true after a successful save of only the changed fields", async () => {
    mutateAsync.mockResolvedValue({ ...SKILL, name: "renamed" });
    const { guardRef } = renderGuarded();
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "renamed" } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await guardRef.current!.save();
    });
    expect(ok).toBe(true);
    expect(mutateAsync).toHaveBeenCalledWith({ id: "s1", patch: { name: "renamed" } });
  });

  it("guard.save(): false on a server error, and every edit is kept", async () => {
    mutateAsync.mockRejectedValue(new Error("500"));
    const { guardRef } = renderGuarded();
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "renamed" } });
    fireEvent.change(screen.getByRole("textbox", { name: C.body }), { target: { value: "# Edited body" } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await guardRef.current!.save();
    });
    expect(ok).toBe(false);
    expect(screen.getByDisplayValue("renamed")).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: C.body }) as HTMLTextAreaElement).value).toBe("# Edited body");
    expect(guardRef.current?.dirty).toBe(true);
  });

  it("guard.save(): false on invalid input, nothing sent, errors shown, edits kept", async () => {
    const { guardRef } = renderGuarded();
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "   " } });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await guardRef.current!.save();
    });
    expect(ok).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(messages.create.errors.name)).toBeInTheDocument();
    expect(guardRef.current?.dirty).toBe(true);
  });

  it("asks the browser to confirm a reload / close only while there are unsaved edits", () => {
    renderGuarded();
    const before = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(before()).toBe(false);
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "x-renamed" } });
    expect(before()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: C.reset }));
    expect(before()).toBe(false);
  });

  it("an outside enabled toggle (list card) updates the form without making it dirty", () => {
    const guardRef: React.MutableRefObject<ConfigGuard | null> = { current: null };
    const onDirtyChange = vi.fn();
    const ui = (skill: Skill) => (
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ConfigTab skill={skill} onDelete={vi.fn()} guardRef={guardRef} onDirtyChange={onDirtyChange} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(SKILL));
    rerender(ui({ ...SKILL, enabled: false }));
    expect(screen.getByRole("switch", { name: "Enable breaking-change" })).toHaveAttribute("aria-checked", "false");
    expect(guardRef.current?.dirty).toBe(false);
    expect(onDirtyChange).not.toHaveBeenLastCalledWith(true);
  });

  it("reports dirty changes to the page (and false again after Cancel)", () => {
    const onDirtyChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ConfigTab skill={SKILL} onDelete={vi.fn()} onDirtyChange={onDirtyChange} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByDisplayValue("breaking-change"), { target: { value: "renamed" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: C.reset }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});
