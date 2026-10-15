/**
 * Create skill from conventions (HW2 #41, #42, #51): explanation, the editable
 * server draft (name / description / type / enabled / body with preview),
 * optional agent, Cancel / Create; 409 and 422 land on the field and keep
 * every edit. Hooks are mocked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../messages/en/conventions.json";
import skillsMessages from "../../../../../../../messages/en/skills.json";

type DraftQ = { data?: ConventionSkillDraft; isLoading: boolean; isError: boolean; error?: Error };
let draftQ: DraftQ;
const createAsync = vi.fn();
vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => draftQ,
  useCreateConventionSkill: () => ({ mutateAsync: createAsync, isPending: false }),
}));
const AGENT = "6f1c2b0e-8d6a-4f7e-9a3b-2c1d0e9f8a7b";
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [{ id: AGENT, name: "API Contract Reviewer" }] }) }));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { CreateConventionSkillModal } from "./CreateConventionSkillModal";

const M = messages.createSkill;
const DRAFT: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "2 house conventions extracted from acme/api",
  type: "convention",
  body: "# acme/api conventions\n\n## Naming\n\n- **Use** camelCase",
  evidence_files: ["src/a.ts"],
  convention_ids: ["a", "b"],
};

beforeEach(() => {
  draftQ = { data: DRAFT, isLoading: false, isError: false };
});
afterEach(() => {
  cleanup();
  createAsync.mockReset();
  success.mockReset();
});

function renderModal() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages, skills: skillsMessages }}>
      <CreateConventionSkillModal repoId="r1" repoName="acme/api" onClose={onClose} onCreated={onCreated} />
    </NextIntlClientProvider>,
  );
  return { onClose, onCreated };
}
const field = (label: string) => screen.getByLabelText(label);
const create = () => fireEvent.click(screen.getByRole("button", { name: M.create }));

describe("CreateConventionSkillModal", () => {
  it("explains the source and pre-fills every field from the draft", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent(M.title);
    expect(screen.getByText(/Merged from 2 accepted conventions in acme\/api/)).toBeInTheDocument();
    expect(field(M.name)).toHaveValue("repo-conventions");
    expect(field(M.description)).toHaveValue(DRAFT.description);
    expect(field(M.type)).toHaveValue("convention");
    expect(screen.getByRole("switch", { name: M.enabled })).toHaveAttribute("aria-checked", "true");
    expect(field(M.body)).toHaveValue(DRAFT.body);
    expect(field(M.agent)).toHaveValue("");
    expect(screen.getByRole("button", { name: M.cancel })).toBeInTheDocument();
  });

  it("the body can be edited and previewed as Markdown", () => {
    renderModal();
    fireEvent.change(field(M.body), { target: { value: "# Edited\n\n- **bold** rule" } });
    fireEvent.click(screen.getByRole("button", { name: M.preview }));
    const preview = screen.getByTestId("convention-skill-preview");
    expect(preview.querySelector("h1")).toHaveTextContent("Edited");
    expect(preview.querySelector("strong")).toHaveTextContent("bold");
  });

  it("creates with every edit and the chosen agent; success toasts, closes and reports", async () => {
    createAsync.mockResolvedValue({ skill: { id: "k", name: "acme-conventions" }, attached_agent_id: AGENT });
    const { onClose, onCreated } = renderModal();
    fireEvent.change(field(M.name), { target: { value: "acme-conventions" } });
    fireEvent.change(field(M.description), { target: { value: "House rules" } });
    fireEvent.change(field(M.type), { target: { value: "rubric" } });
    fireEvent.click(screen.getByRole("switch", { name: M.enabled }));
    fireEvent.change(field(M.body), { target: { value: "# Rules\n- one" } });
    fireEvent.change(field(M.agent), { target: { value: AGENT } });
    create();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createAsync).toHaveBeenCalledWith({
      name: "acme-conventions",
      description: "House rules",
      type: "rubric",
      enabled: false,
      body: "# Rules\n- one",
      agent_id: AGENT,
    });
    expect(success).toHaveBeenCalledWith('Created skill "acme-conventions" and attached it to API Contract Reviewer');
    expect(onCreated).toHaveBeenCalledWith({ skill: { id: "k", name: "acme-conventions" }, attached_agent_id: AGENT });
  });

  it("409: the name is taken → shown on Name, every edit kept, modal stays open; a rename succeeds", async () => {
    createAsync.mockRejectedValueOnce(new ApiError("A skill named \"repo-conventions\" already exists", 409, "conflict", { names: ["repo-conventions"] }));
    const { onClose } = renderModal();
    fireEvent.change(field(M.body), { target: { value: "# my edited body" } });
    create();
    expect(await screen.findByRole("alert")).toHaveTextContent('A skill named "repo-conventions" already exists — choose another name.');
    expect(field(M.body)).toHaveValue("# my edited body");
    expect(onClose).not.toHaveBeenCalled();

    createAsync.mockResolvedValueOnce({ skill: { id: "k", name: "repo-conventions-2" }, attached_agent_id: null });
    fireEvent.change(field(M.name), { target: { value: "repo-conventions-2" } });
    expect(screen.queryByRole("alert")).toBeNull(); // editing the field clears its error
    create();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createAsync).toHaveBeenLastCalledWith(expect.objectContaining({ name: "repo-conventions-2", body: "# my edited body", agent_id: null }));
    expect(success).toHaveBeenCalledWith('Created skill "repo-conventions-2"');
  });

  it("client-side rules stop a bad name or an executable body before any request", () => {
    renderModal();
    fireEvent.change(field(M.name), { target: { value: "Repo Conventions" } });
    fireEvent.change(field(M.body), { target: { value: "<script>alert(1)</script>" } });
    create();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((a) => /^Use lowercase/.test(a ?? ""))).toBe(true);
    expect(alerts.some((a) => /Executable content is not allowed/.test(a ?? ""))).toBe(true);
    expect(createAsync).not.toHaveBeenCalled();
  });

  it("422 from the server is shown on its field", async () => {
    createAsync.mockRejectedValue(
      new ApiError("Request validation failed", 422, "validation_error", [{ instancePath: "/description", message: "Too long" }]),
    );
    renderModal();
    create();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too long");
  });

  it("loading and a failing draft", () => {
    draftQ = { data: undefined, isLoading: true, isError: false };
    renderModal();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByRole("button", { name: M.create })).toBeDisabled();
    cleanup();
    draftQ = { data: undefined, isLoading: false, isError: true, error: new Error("Accept at least one convention first") };
    renderModal();
    expect(screen.getByRole("alert")).toHaveTextContent("Accept at least one convention first");
  });
});
