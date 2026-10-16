/**
 * Import from file (HW2 #15): pick / drop a .md or .zip → server preview →
 * review + edit each skill → import (disabled). Client-side file checks,
 * live rule checks, in-file duplicates, and server errors (unsafe archive,
 * 409 taken name, 422, network) are covered. Hooks are mocked.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import messages from "../../../../../messages/en/skills.json";

const previewAsync = vi.fn();
const importAsync = vi.fn();
let importPending = false;
vi.mock("@/lib/hooks/skills", () => ({
  usePreviewSkillImport: () => ({ mutateAsync: previewAsync, isPending: false }),
  useImportSkills: () => ({ mutateAsync: importAsync, isPending: importPending }),
}));
const success = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { success: (m: string) => success(m), error: vi.fn(), info: vi.fn() } }));

import { ImportSkillModal } from "./ImportSkillModal";

const T = messages.importFile;

afterEach(() => {
  cleanup();
  previewAsync.mockReset();
  importAsync.mockReset();
  success.mockReset();
  importPending = false;
});

const PREVIEW: SkillImportPreview = {
  filename: "pack.zip",
  format: "zip",
  skipped: ["pack/"],
  items: [
    { path: "pack/a.md", name: "api-rules", description: "API rules", type: "security", body: "# API\nNo **removed** fields.", issues: [] },
    { path: "pack/b.md", name: "Bad Name", description: "", type: "custom", body: "# B", issues: [] },
  ],
};

function renderModal() {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ImportSkillModal onClose={onClose} onImported={onImported} />
    </NextIntlClientProvider>,
  );
  return { onClose, onImported };
}

const file = (name: string, content = "# x", size?: number) => {
  const f = new File([content], name);
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
};
const choose = (f: File) => fireEvent.change(screen.getByLabelText(T.inputLabel), { target: { files: [f] } });
const card = (path: string) => document.querySelector(`[data-import-path="${path}"]`) as HTMLElement;
const submitButton = () => screen.getByRole("button", { name: /^Import( \d+ skills?)?$|^Importing/ });

async function loadPreview(preview: SkillImportPreview = PREVIEW) {
  previewAsync.mockResolvedValue(preview);
  renderModal();
  choose(file("pack.zip", "PK"));
  await screen.findByTestId("import-candidates");
}

describe("ImportSkillModal — picking a file", () => {
  it("rejects unsupported types, empty and oversized files before any request", async () => {
    renderModal();
    choose(file("tool.exe"));
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.type);
    choose(file("empty.md", ""));
    expect(screen.getByRole("alert")).toHaveTextContent(T.errors.empty);
    choose(file("huge.zip", "PK", 3 * 1024 * 1024));
    expect(screen.getByRole("alert")).toHaveTextContent("The file is larger than 2 MB.");
    expect(previewAsync).not.toHaveBeenCalled();
  });

  it("sends the file name and base64 content to the preview", async () => {
    await loadPreview();
    expect(previewAsync).toHaveBeenCalledWith({ filename: "pack.zip", content_base64: btoa("PK") });
  });

  it("a dropped file is previewed like a picked one", async () => {
    previewAsync.mockResolvedValue(PREVIEW);
    renderModal();
    fireEvent.drop(screen.getByTestId("import-drop-zone"), { dataTransfer: { files: [file("rules.md")] } });
    await screen.findByTestId("import-candidates");
    expect(previewAsync).toHaveBeenCalledWith({ filename: "rules.md", content_base64: btoa("# x") });
  });

  it("an unsafe archive shows the server's reason and every rejected entry", async () => {
    previewAsync.mockRejectedValue(
      new ApiError("The archive cannot be imported: 2 unsafe or unsupported entries", 422, "unsafe_archive", {
        entries: [
          { path: "../evil.md", reason: "path traversal (..)" },
          { path: "run.sh", reason: "only .md files can be imported" },
        ],
      }),
    );
    renderModal();
    choose(file("evil.zip", "PK"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The archive cannot be imported");
    const entries = within(screen.getByRole("list", { name: T.rejectedEntries })).getAllByRole("listitem");
    expect(entries.map((e) => e.textContent)).toEqual(["../evil.md: path traversal (..)", "run.sh: only .md files can be imported"]);
    expect(screen.queryByTestId("import-candidates")).toBeNull();
  });

  it("a network / server failure is shown and the picker stays available", async () => {
    previewAsync.mockRejectedValue(new ApiError("Cannot reach the DevDigest engine", 0, "network_error"));
    renderModal();
    choose(file("a.md"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the DevDigest engine");
    expect(screen.getByTestId("import-drop-zone")).toBeInTheDocument();
  });
});

describe("ImportSkillModal — review before import", () => {
  it("lists every skill with editable fields, renders the body, and warns that imports stay disabled", async () => {
    await loadPreview();
    expect(screen.getByText("2 skills found in pack.zip")).toBeInTheDocument();
    expect(screen.getByText(T.vetting)).toBeInTheDocument();
    const a = card("pack/a.md");
    expect(within(a).getByLabelText(T.name)).toHaveValue("api-rules");
    expect(within(a).getByLabelText(T.description)).toHaveValue("API rules");
    expect(within(a).getByLabelText(T.type)).toHaveValue("security");
    expect(within(within(a).getByTestId("import-body-rendered")).getByText("removed").tagName).toBe("STRONG");
  });

  it("blocks the import while an included skill breaks a rule; fixing it enables the button", async () => {
    await loadPreview();
    expect(within(card("pack/b.md")).getByRole("alert")).toHaveTextContent(/^Use lowercase/);
    expect(submitButton()).toBeDisabled();
    fireEvent.change(within(card("pack/b.md")).getByLabelText(T.name), { target: { value: "b-rules" } });
    expect(within(card("pack/b.md")).queryByRole("alert")).toBeNull();
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Import 2 skills");
  });

  it("the body can be edited; executable content is flagged live", async () => {
    await loadPreview();
    const a = card("pack/a.md");
    fireEvent.click(within(a).getByRole("button", { name: T.edit }));
    fireEvent.change(within(a).getByLabelText(T.body), { target: { value: "# x\n<script>alert(1)</script>" } });
    expect(within(a).getByRole("alert")).toHaveTextContent("Executable content is not allowed (<script> tag)");
  });

  it("two included skills with the same name block the import; leaving one out unblocks it", async () => {
    await loadPreview({ ...PREVIEW, items: [PREVIEW.items[0]!, { ...PREVIEW.items[0]!, path: "pack/c.md" }] });
    expect(within(card("pack/c.md")).getByRole("alert")).toHaveTextContent('"api-rules" is used by more than one skill in this import');
    expect(submitButton()).toBeDisabled();
    fireEvent.click(within(card("pack/c.md")).getByRole("checkbox", { name: "Import api-rules" }));
    expect(within(card("pack/c.md")).getByTestId("import-status")).toHaveTextContent(T.excluded);
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Import 1 skill");
  });

  it("a name already taken (from the server preview) blocks until it is renamed", async () => {
    await loadPreview({
      ...PREVIEW,
      items: [{ ...PREVIEW.items[0]!, issues: [{ field: "name", message: 'A skill named "api-rules" already exists' }] }],
    });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(within(card("pack/a.md")).getByLabelText(T.name), { target: { value: "api-rules-v2" } });
    expect(submitButton()).toBeEnabled();
  });

  it("imports only the included, edited skills; success closes and reports the created skills", async () => {
    const created = [{ id: "s1", name: "api-rules", source: "imported", enabled: false }];
    importAsync.mockResolvedValue(created);
    const { onClose, onImported } = (await loadPreviewWithHandles())!;
    fireEvent.click(within(card("pack/b.md")).getByRole("checkbox"));
    fireEvent.change(within(card("pack/a.md")).getByLabelText(T.type), { target: { value: "rubric" } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(importAsync).toHaveBeenCalledWith([{ name: "api-rules", description: "API rules", type: "rubric", body: "# API\nNo **removed** fields." }]);
    expect(success).toHaveBeenCalledWith("Imported 1 skill: disabled until you review and enable it.");
    expect(onImported).toHaveBeenCalledWith(created);
  });

  it("409 from the import puts 'already exists' on that skill and keeps the modal open", async () => {
    importAsync.mockRejectedValue(new ApiError("A skill with this name already exists", 409, "conflict", { names: ["api-rules"] }));
    const { onClose } = (await loadPreviewWithHandles())!;
    fireEvent.click(within(card("pack/b.md")).getByRole("checkbox"));
    fireEvent.click(submitButton());
    expect(await within(card("pack/a.md")).findByRole("alert")).toHaveTextContent('A skill named "api-rules" already exists');
    expect(onClose).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it("422 from the import is mapped onto the field of that skill", async () => {
    importAsync.mockRejectedValue(
      new ApiError("Request validation failed", 422, "validation_error", [
        { instancePath: "/items/0/body", params: { issue: { path: ["items", 0, "body"] } }, message: "Body is empty" },
      ]),
    );
    await loadPreviewWithHandles();
    fireEvent.click(within(card("pack/b.md")).getByRole("checkbox"));
    fireEvent.click(submitButton());
    expect(await within(card("pack/a.md")).findByRole("alert")).toHaveTextContent("Body is empty");
  });

  it("Choose another file goes back to the picker", async () => {
    await loadPreview();
    fireEvent.click(screen.getByRole("button", { name: T.chooseAnother }));
    expect(screen.getByTestId("import-drop-zone")).toBeInTheDocument();
    expect(screen.queryByTestId("import-candidates")).toBeNull();
  });
});

async function loadPreviewWithHandles() {
  previewAsync.mockResolvedValue(PREVIEW);
  const handles = renderModal();
  choose(file("pack.zip", "PK"));
  await screen.findByTestId("import-candidates");
  return handles;
}
