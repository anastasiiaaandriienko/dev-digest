/**
 * L07 B11 — Export to CI wizard: shell, Target and Preview (specs/export-to-ci.md §6.3;
 * AC-CI-01..08, 18, 63, 64, 83). Data hooks are mocked (a small stateful preview
 * mutation so loading / error / retry run through the real component); no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiFile, CiInstallationView, CiPreview } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";

type RepoQ = { data?: CiInstallationView[]; isSuccess: boolean; isLoading: boolean; isError: boolean };
let repoInstallations: Record<string, RepoQ> = {};
const previewCalls: unknown[] = [];
let previewImpl: (vars: unknown) => Promise<CiPreview>;

vi.mock("@/lib/hooks/ci", async () => {
  const React = await import("react");
  return {
    useRepoCiInstallations: (repo: string | null) =>
      repo ? (repoInstallations[repo] ?? { data: [], isSuccess: true, isLoading: false, isError: false }) : { isSuccess: false, isLoading: false, isError: false },
    useCiPreview: () => {
      const [st, setSt] = React.useState<{ isPending: boolean; isError: boolean; error: Error | null }>({ isPending: false, isError: false, error: null });
      const mutate = React.useCallback(
        (vars: unknown, opts?: { onSuccess?: (r: CiPreview) => void; onError?: (e: Error) => void }) => {
          previewCalls.push(vars);
          setSt({ isPending: true, isError: false, error: null });
          previewImpl(vars).then(
            (res) => {
              setSt({ isPending: false, isError: false, error: null });
              opts?.onSuccess?.(res);
            },
            (err: Error) => {
              setSt({ isPending: false, isError: true, error: err });
              opts?.onError?.(err);
            },
          );
        },
        [],
      );
      return { ...st, mutate };
    },
  };
});
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { full_name: "acme/widgets" },
    repos: [{ full_name: "acme/widgets" }, { full_name: "acme/api" }],
  }),
}));

import { ExportWizard } from "./ExportWizard";
import type { CiWizardRequest } from "../../helpers";
import { MAX_WORKFLOW_BYTES, WORKFLOW_PATH } from "./constants";
import { exportBody, initialState, occupyingInstallation, previewKey, wizardReducer, workflowOverLimit } from "./helpers";

const AGENT: Agent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};
const WORKFLOW = "name: DevDigest review\non:\n  pull_request:\n";
const BUNDLE = "/* runner */".padEnd(25_000, "x");
const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: '{ "name": "Security Reviewer" }', editable: false },
  { path: ".devdigest/runner/index.js", contents: BUNDLE, editable: false },
  { path: ".devdigest/runner/package.json", contents: '{"type":"module"}\n', editable: false },
  { path: WORKFLOW_PATH, contents: WORKFLOW, editable: true },
];

function installation(over: Partial<CiInstallationView>): CiInstallationView {
  return {
    id: "i1",
    agent_id: AGENT.id,
    repo: "acme/widgets",
    target_type: "gha",
    installed_at: "x",
    status: "active",
    agent_version: 3,
    pr_url: null,
    updated_at: "x",
    last_synced_at: null,
    agent_name: "Security Reviewer",
    last_run_status: null,
    last_run_at: null,
    ...over,
  };
}

function open(request: CiWizardRequest = { mode: "add" }) {
  const onClose = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ExportWizard agent={AGENT} request={request} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onClose };
}
const continueButton = () => screen.getByRole("button", { name: "Continue" });
const toPreview = async () => {
  fireEvent.click(continueButton());
  await waitFor(() => expect(screen.getByRole("listbox", { name: "FILES TO CREATE" })).toBeInTheDocument());
};

beforeEach(() => {
  repoInstallations = {};
  previewCalls.length = 0;
  previewImpl = async () => ({ files: FILES });
});
afterEach(cleanup);

describe("wizard shell (AC-CI-01, 02, 18)", () => {
  it("shows the title, the agent in the subtitle and the four steps", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Export to CI")).toBeInTheDocument();
    expect(within(dialog).getByText("Run Security Reviewer automatically on pull requests")).toBeInTheDocument();
    for (const label of ["Target", "Preview", "Configure", "Install"]) expect(within(dialog).getByText(label)).toBeInTheDocument();
  });

  it("× and Esc close it; nothing is requested before Preview", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(previewCalls).toEqual([]);
  });
});

describe("Target (AC-CI-03..05, 63, 64)", () => {
  it("GitHub Actions is selected and recommended; the other targets are disabled 'Not available yet'", () => {
    open();
    const gha = screen.getByRole("radio", { name: /GitHub Actions/ });
    expect(gha).toHaveAttribute("aria-checked", "true");
    expect(within(gha).getByText("recommended")).toBeInTheDocument();
    for (const name of ["CircleCI", "Jenkins", "Generic CLI"]) {
      const card = screen.getByRole("radio", { name: new RegExp(name) });
      expect(card).toBeDisabled();
      expect(card).toHaveAttribute("aria-checked", "false");
      expect(within(card).getByText("Not available yet")).toBeInTheDocument();
    }
  });

  it("the repo picker lists workspace repos and defaults to the active repo; Continue is enabled when it is free", () => {
    open();
    const picker = screen.getByRole("combobox", { name: "Target repository" });
    expect(picker).toHaveValue("acme/widgets");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual(["acme/widgets", "acme/api"]);
    expect(continueButton()).toBeEnabled();
  });

  it("another agent's installation (any status) occupies the repo: a warning names it and Continue is disabled", () => {
    repoInstallations["acme/api"] = {
      data: [installation({ agent_id: "other", agent_name: "Perf Reviewer", repo: "acme/api", status: "error" })],
      isSuccess: true,
      isLoading: false,
      isError: false,
    };
    open();
    fireEvent.change(screen.getByRole("combobox", { name: "Target repository" }), { target: { value: "acme/api" } });
    expect(screen.getByRole("alert")).toHaveTextContent("acme/api already runs the agent “Perf Reviewer” in CI.");
    expect(continueButton()).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Target repository" }), { target: { value: "acme/widgets" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(continueButton()).toBeEnabled();
  });

  it("the agent's own installation does not block; checking or a failed check keeps Continue disabled", () => {
    repoInstallations["acme/widgets"] = { data: [installation({})], isSuccess: true, isLoading: false, isError: false };
    open();
    expect(continueButton()).toBeEnabled();
    cleanup();
    repoInstallations["acme/widgets"] = { isSuccess: false, isLoading: true, isError: false };
    open();
    expect(screen.getByText("Checking who runs in this repository…")).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
    cleanup();
    repoInstallations["acme/widgets"] = { isSuccess: false, isLoading: false, isError: true };
    open();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not check");
    expect(continueButton()).toBeDisabled();
  });

  it("Update CI config: the installation's repo is fixed, no picker (AC-CI-64)", () => {
    open({ mode: "update", repo: "acme/api", target: "gha" });
    expect(screen.queryByRole("combobox", { name: "Target repository" })).toBeNull();
    expect(screen.getByTestId("wizard-repo-locked")).toHaveTextContent("acme/api");
    expect(screen.getByText("Updating the CI config of acme/api.")).toBeInTheDocument();
  });
});

describe("Preview (AC-CI-06..08, 83)", () => {
  it("generates the files for the chosen repo with the default options and lists every path", async () => {
    open();
    await toPreview();
    expect(previewCalls).toEqual([
      { agentId: AGENT.id, body: { repo: "acme/widgets", target: "gha", triggers: ["opened", "synchronize"], post_as: "pr_comment" } },
    ]);
    const list = screen.getByRole("listbox", { name: "FILES TO CREATE" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(FILES.map((f) => f.path));
    expect(screen.getByText(/4 files/)).toBeInTheDocument();
  });

  it("shows the selected file read-only; the runner bundle truncated; contents as text", async () => {
    previewImpl = async () => ({ files: [{ ...FILES[0]!, contents: "<script>alert(1)</script>" }, ...FILES.slice(1)] });
    const { container } = open();
    await toPreview();
    expect(screen.getByTestId("wizard-file-contents")).toHaveTextContent("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("read-only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: ".devdigest/runner/index.js" }));
    expect(screen.getByTestId("wizard-file-contents").textContent).toHaveLength(20_000);
    expect(screen.getByText("Showing the first 20000 of 25000 characters.")).toBeInTheDocument();
  });

  it("only the workflow is editable; edits survive Back / Continue without regenerating (AC-CI-07)", async () => {
    open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    expect(screen.getByText("editable")).toBeInTheDocument();
    const editor = screen.getByRole("textbox", { name: WORKFLOW_PATH });
    expect(editor).toHaveValue(WORKFLOW);
    fireEvent.change(editor, { target: { value: `${WORKFLOW}# edited\n` } });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("combobox", { name: "Target repository" })).toBeInTheDocument();
    fireEvent.click(continueButton());
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue(`${WORKFLOW}# edited\n`);
    expect(previewCalls).toHaveLength(1);
  });

  /** Preview whose workflow names the repository it was generated for. */
  const perRepoPreview = async (vars: unknown) => {
    const repo = (vars as { body: { repo: string } }).body.repo;
    return { files: FILES.map((f) => (f.path === WORKFLOW_PATH ? { ...f, contents: `# generated for ${repo}\n` } : f)) };
  };
  const editWorkflow = (text: string) => {
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: text } });
  };

  it("another repo drops the workflow edit and shows the new repo's generated files", async () => {
    previewImpl = perRepoPreview;
    open();
    await toPreview();
    editWorkflow("# edited for acme/widgets\n");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Target repository" }), { target: { value: "acme/api" } });
    await toPreview();
    expect(previewCalls).toHaveLength(2);
    expect((previewCalls[1] as { body: unknown }).body).toEqual({
      repo: "acme/api",
      target: "gha",
      triggers: ["opened", "synchronize"],
      post_as: "pr_comment",
    });
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# generated for acme/api\n");
  });

  it("going back to the first repo does not bring the old edit back", async () => {
    previewImpl = perRepoPreview;
    open();
    await toPreview();
    editWorkflow("# edited for acme/widgets\n");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const picker = screen.getByRole("combobox", { name: "Target repository" });
    fireEvent.change(picker, { target: { value: "acme/api" } });
    fireEvent.change(picker, { target: { value: "acme/widgets" } });
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# generated for acme/widgets\n");
  });

  it("re-selecting the same repo on Target keeps the edit and does not regenerate", async () => {
    previewImpl = perRepoPreview;
    open();
    await toPreview();
    editWorkflow("# my edit\n");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Target repository" }), { target: { value: "acme/widgets" } });
    fireEvent.click(continueButton());
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# my edit\n");
    expect(previewCalls).toHaveLength(1);
  });

  it("a failed preview shows the error with Retry and keeps Continue disabled; Retry generates again (AC-CI-08)", async () => {
    previewImpl = async () => {
      throw new Error("acme/widgets already has files DevDigest did not write for this agent");
    };
    open();
    fireEvent.click(continueButton());
    await waitFor(() => expect(screen.getByText("Could not generate the files")).toBeInTheDocument());
    expect(screen.getByText(/already has files DevDigest did not write/)).toBeInTheDocument();
    expect(continueButton()).toBeDisabled();
    expect(previewCalls).toHaveLength(1); // no automatic retry loop

    previewImpl = async () => ({ files: FILES });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(screen.getByRole("listbox", { name: "FILES TO CREATE" })).toBeInTheDocument());
    expect(previewCalls).toHaveLength(2);
  });

  it("an edited workflow over 64 KB shows the limit (AC-CI-83); Continue stays disabled while Configure is not available", async () => {
    open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "x".repeat(MAX_WORKFLOW_BYTES + 1) } });
    expect(screen.getByRole("alert")).toHaveTextContent("The workflow is 65537 bytes; the limit is 65536 bytes (64 KB).");
    expect(continueButton()).toBeDisabled();
    expect(continueButton()).toHaveAttribute("title", "Configure and Install are not available yet.");
  });

  it("loading shows a progress note", async () => {
    let resolve!: (r: CiPreview) => void;
    previewImpl = () => new Promise((r) => (resolve = r));
    open();
    fireEvent.click(continueButton());
    expect(await screen.findByText("Generating…")).toBeInTheDocument();
    await act(async () => resolve({ files: FILES }));
    expect(screen.getByRole("listbox", { name: "FILES TO CREATE" })).toBeInTheDocument();
  });
});

describe("wizard helpers", () => {
  it("initialState: add uses the active repo and the Configure defaults; update fixes repo and target", () => {
    expect(initialState({ mode: "add" }, "acme/x")).toMatchObject({ step: 0, repo: "acme/x", target: "gha", triggers: ["opened", "synchronize"], postAs: "pr_comment" });
    expect(initialState({ mode: "add" }, null).repo).toBe("");
    const u = initialState({ mode: "update", repo: "acme/y", target: "gha" }, "acme/x");
    expect(u.repo).toBe("acme/y");
    expect(wizardReducer(u, { type: "setRepo", repo: "acme/z" }).repo).toBe("acme/y");
  });

  it("setRepo: another repo drops the edit (and keeps it out of the export body); the same repo or update mode change nothing", () => {
    const edited = { ...initialState({ mode: "add" }, "acme/x"), editedWorkflow: "# edit for x" };
    expect(wizardReducer(edited, { type: "setRepo", repo: "acme/x" })).toBe(edited);
    const moved = wizardReducer(edited, { type: "setRepo", repo: "acme/y" });
    expect(moved).toMatchObject({ repo: "acme/y", editedWorkflow: null });
    expect(exportBody(moved).files).toBeUndefined();
    const update = { ...initialState({ mode: "update", repo: "acme/x", target: "gha" }, null), editedWorkflow: "e" };
    expect(wizardReducer(update, { type: "setRepo", repo: "acme/y" })).toBe(update);
  });

  it("a new or retried preview keeps the edit (Retry for the same repo never loses it)", () => {
    const edited = { ...initialState({ mode: "add" }, "acme/x"), editedWorkflow: "# edit" };
    const loaded = wizardReducer(edited, { type: "previewLoaded", files: FILES, key: previewKey(edited) });
    expect(loaded.editedWorkflow).toBe("# edit");
    expect(exportBody(loaded).files).toEqual([{ path: WORKFLOW_PATH, contents: "# edit", editable: true }]);
  });

  it("steps stay within 0..3; previewLoaded keeps a still-present selection", () => {
    let st = initialState({ mode: "add" }, "acme/x");
    st = wizardReducer(st, { type: "back" });
    expect(st.step).toBe(0);
    for (let i = 0; i < 5; i++) st = wizardReducer(st, { type: "next" });
    expect(st.step).toBe(3);
    st = wizardReducer({ ...st, selectedPath: WORKFLOW_PATH }, { type: "previewLoaded", files: FILES, key: "k" });
    expect(st.selectedPath).toBe(WORKFLOW_PATH);
    st = wizardReducer({ ...st, selectedPath: "gone" }, { type: "previewLoaded", files: FILES, key: "k" });
    expect(st.selectedPath).toBe(FILES[0]!.path);
  });

  it("previewKey ignores trigger order; exportBody carries the edit only when there is one", () => {
    const st = initialState({ mode: "add" }, "acme/x");
    expect(previewKey({ ...st, triggers: ["synchronize", "opened"] })).toBe(previewKey(st));
    expect(exportBody(st)).toEqual({ repo: "acme/x", target: "gha", triggers: ["opened", "synchronize"], post_as: "pr_comment" });
    expect(exportBody({ ...st, editedWorkflow: "w" }).files).toEqual([{ path: WORKFLOW_PATH, contents: "w", editable: true }]);
  });

  it("workflowOverLimit counts UTF-8 bytes; occupyingInstallation ignores the agent's own", () => {
    expect(workflowOverLimit({ editedWorkflow: null })).toBeNull();
    expect(workflowOverLimit({ editedWorkflow: "x".repeat(MAX_WORKFLOW_BYTES) })).toBeNull();
    expect(workflowOverLimit({ editedWorkflow: "é".repeat(32_769) })).toBe(65_538);
    expect(occupyingInstallation([installation({})], AGENT.id)).toBeNull();
    expect(occupyingInstallation([installation({ agent_id: "x" })], AGENT.id)?.agent_id).toBe("x");
    expect(occupyingInstallation(undefined, AGENT.id)).toBeNull();
  });
});
