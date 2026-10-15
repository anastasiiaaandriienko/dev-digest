import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";

const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/skills", () => ({ useCreateSkill: () => ({ mutateAsync, isPending: false }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { CreateSkillModal } from "./CreateSkillModal";
import { validateSkillForm } from "./helpers";

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
  success.mockReset();
});

const C = messages.create;

function renderModal() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <CreateSkillModal onClose={onClose} onCreated={onCreated} />
    </NextIntlClientProvider>,
  );
  return { onClose, onCreated };
}

const nameInput = () => screen.getByPlaceholderText(C.namePlaceholder);
const descInput = () => screen.getByPlaceholderText(C.descriptionPlaceholder);
// The body placeholder is multi-line; Testing Library collapses whitespace when matching text.
const bodyInput = () => screen.getByPlaceholderText(/^# Rule/);
const submit = () => fireEvent.click(screen.getByRole("button", { name: C.submit }));

describe("CreateSkillModal", () => {
  it("has name, description, type and Markdown body fields", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent(C.title);
    expect(nameInput()).toBeInTheDocument();
    expect(descInput()).toBeInTheDocument();
    expect(bodyInput().tagName).toBe("TEXTAREA");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["rubric", "convention", "security", "custom"]);
  });

  it("shows inline errors and does not submit an empty form", () => {
    renderModal();
    submit();
    expect(screen.getByText(C.errors.name)).toBeInTheDocument();
    expect(screen.getByText(C.errors.body)).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("Preview renders the Markdown body", () => {
    renderModal();
    fireEvent.change(bodyInput(), { target: { value: "# Rule\n\nFlag **removed** fields." } });
    fireEvent.click(screen.getByRole("button", { name: C.preview }));
    const preview = screen.getByTestId("create-skill-preview");
    expect(preview.querySelector("h1")).toHaveTextContent("Rule");
    expect(preview.querySelector("strong")).toHaveTextContent("removed");
  });

  it("submits the trimmed values, toasts, closes and reports the created skill", async () => {
    const created = { id: "s9", name: "breaking-change" } as Skill;
    mutateAsync.mockResolvedValue(created);
    const { onClose, onCreated } = renderModal();
    fireEvent.change(nameInput(), { target: { value: "  breaking-change  " } });
    fireEvent.change(descInput(), { target: { value: "Flag API removals" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "security" } });
    fireEvent.change(bodyInput(), { target: { value: "# Breaking" } });
    submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(mutateAsync).toHaveBeenCalledWith({
      name: "breaking-change",
      description: "Flag API removals",
      type: "security",
      body: "# Breaking",
    });
    expect(success).toHaveBeenCalledWith('Created skill "breaking-change".');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a server error keeps the modal open (the global handler toasts it)", async () => {
    mutateAsync.mockRejectedValue(new Error("422"));
    const { onClose, onCreated } = renderModal();
    fireEvent.change(nameInput(), { target: { value: "x" } });
    fireEvent.change(bodyInput(), { target: { value: "# x" } });
    submit();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Cancel closes without saving", () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: C.cancel }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe("validateSkillForm", () => {
  const ok = { name: "a", description: "", type: "custom" as const, body: "# x" };
  it("accepts a valid form and trims the name", () => {
    expect(validateSkillForm({ ...ok, name: "  a  " })).toEqual({ ok: true, data: ok });
  });
  it("flags each invalid field with the shared contract's limits", () => {
    expect(validateSkillForm({ ...ok, name: " ", body: "" })).toEqual({ ok: false, errors: { name: true, body: true } });
    expect(validateSkillForm({ ...ok, description: "x".repeat(2001) })).toEqual({ ok: false, errors: { description: true } });
    expect(validateSkillForm({ ...ok, name: "x".repeat(121) })).toEqual({ ok: false, errors: { name: true } });
  });
});
