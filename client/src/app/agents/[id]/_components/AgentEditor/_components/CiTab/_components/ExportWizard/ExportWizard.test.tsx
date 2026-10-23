/**
 * L07 B11–B12 — Export to CI wizard: Target → Preview → Configure → Install
 * (specs/export-to-ci.md §6.3; AC-CI-01..19, 63, 64, 79, 83, 84). Data hooks are mocked
 * with small stateful mutations so loading / error / retry run through the real
 * component; no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiExport, CiFile, CiInstallationView, CiPreview } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";
import agentMessages from "../../../../../../../../../../messages/en/agents.json";

type RepoQ = { data?: CiInstallationView[]; isSuccess: boolean; isLoading: boolean; isError: boolean };
let repoInstallations: Record<string, RepoQ> = {};
const previewCalls: unknown[] = [];
let previewImpl: (vars: unknown) => Promise<CiPreview>;
const exportCalls: unknown[] = [];
let exportImpl: (vars: unknown) => Promise<CiExport>;
const zipCalls: unknown[] = [];
let zipImpl: (vars: unknown) => Promise<{ filename: string; size: number }>;

vi.mock("@/lib/hooks/ci", async () => {
  const React = await import("react");
  type Opts<R> = { onSuccess?: (r: R) => void; onError?: (e: Error) => void; onSettled?: () => void };
  /** A stateful stand-in for a React Query mutation (isPending / isError / error). */
  function useFakeMutation<R>(calls: unknown[], impl: () => (vars: unknown) => Promise<R>) {
    const [st, setSt] = React.useState<{ isPending: boolean; isError: boolean; error: Error | null }>({ isPending: false, isError: false, error: null });
    const mutate = React.useCallback((vars: unknown, opts?: Opts<R>) => {
      calls.push(vars);
      setSt({ isPending: true, isError: false, error: null });
      impl()(vars).then(
        (res) => {
          setSt({ isPending: false, isError: false, error: null });
          opts?.onSuccess?.(res);
          opts?.onSettled?.();
        },
        (err: Error) => {
          setSt({ isPending: false, isError: true, error: err });
          opts?.onError?.(err);
          opts?.onSettled?.();
        },
      );
    }, []);
    return { ...st, mutate };
  }
  return {
    useRepoCiInstallations: (repo: string | null) =>
      repo ? (repoInstallations[repo] ?? { data: [], isSuccess: true, isLoading: false, isError: false }) : { isSuccess: false, isLoading: false, isError: false },
    useCiPreview: () => useFakeMutation(previewCalls, () => previewImpl),
    useExportCi: () => useFakeMutation(exportCalls, () => exportImpl),
    useExportCiZip: () => useFakeMutation(zipCalls, () => zipImpl),
  };
});
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { full_name: "acme/widgets" },
    repos: [{ full_name: "acme/widgets" }, { full_name: "acme/api" }],
  }),
}));

import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
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
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages, agents: agentMessages }}>
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

let toasts: { kind: string; msg: string }[];
beforeEach(() => {
  repoInstallations = {};
  previewCalls.length = 0;
  previewImpl = async () => ({ files: FILES });
  exportCalls.length = 0;
  exportImpl = async () => ({ installation: {} as CiExport["installation"], files: FILES, pr_url: "https://github.com/acme/widgets/pull/12" });
  zipCalls.length = 0;
  zipImpl = async () => ({ filename: "devdigest-ci-security-reviewer.zip", size: 4 });
  toasts = [];
  for (const kind of ["success", "error", "info"] as const) {
    vi.spyOn(notify, kind).mockImplementation((msg: string) => void toasts.push({ kind, msg }));
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it("an edited workflow over 64 KB shows the limit and blocks Continue (AC-CI-83)", async () => {
    open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "x".repeat(MAX_WORKFLOW_BYTES + 1) } });
    expect(screen.getByRole("alert")).toHaveTextContent("The workflow is 65537 bytes; the limit is 65536 bytes (64 KB).");
    expect(continueButton()).toBeDisabled();
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

// ---- B12: Configure and Install ------------------------------------------------------------

const toConfigure = async () => {
  await toPreview();
  fireEvent.click(continueButton());
  await waitFor(() => expect(screen.getByRole("group", { name: "Trigger" })).toBeInTheDocument());
};
const chip = (name: string) => screen.getByRole("button", { name });
const installButton = () => screen.getByRole("button", { name: /^(Install|Installing…)$/ });
const toInstall = async () => {
  await toConfigure();
  fireEvent.click(continueButton());
  await waitFor(() => expect(installButton()).toBeEnabled());
};
/** The generated workflow names the triggers / post_as it was made for. */
const optionsPreview = async (vars: unknown) => {
  const b = (vars as { body: { repo: string; triggers: string[]; post_as: string } }).body;
  return {
    files: FILES.map((f) =>
      f.path === WORKFLOW_PATH ? { ...f, contents: `# ${b.repo} [${b.triggers.join(",")}] ${b.post_as}\n` } : f,
    ),
  };
};

describe("Configure (AC-CI-09..13, 79)", () => {
  it("defaults: opened + synchronize on, reopened off, PR comment; static secret badges; merge-blocking info with the agent's Fail CI on", async () => {
    open();
    await toConfigure();
    expect(chip("opened")).toHaveAttribute("aria-pressed", "true");
    expect(chip("synchronize")).toHaveAttribute("aria-pressed", "true");
    expect(chip("reopened")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("radio", { name: "PR comment" })).toBeChecked();
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText("auto-provided")).toBeInTheDocument();
    expect(screen.getByText("Add these to your repo’s Actions secrets before the workflow runs.")).toBeInTheDocument();
    expect(screen.getByText(/now: Block on critical \(recommended\)/)).toBeInTheDocument();
    expect(screen.getByText(/mark the DevDigest check as required in branch protection or a ruleset/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull(); // no secret input anywhere
  });

  it("no trigger → an error and Continue disabled; one trigger is enough", async () => {
    open();
    await toConfigure();
    fireEvent.click(chip("opened"));
    fireEvent.click(chip("synchronize"));
    expect(screen.getByRole("alert")).toHaveTextContent("Select at least one trigger.");
    expect(continueButton()).toBeDisabled();
    fireEvent.click(chip("reopened"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(continueButton()).toBeEnabled();
  });

  it("GitHub review shows the repository-setting note (AC-CI-79)", async () => {
    open();
    await toConfigure();
    expect(screen.queryByText(/lets GitHub Actions create pull request reviews/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "GitHub review" }));
    expect(screen.getByText(/lets GitHub Actions create pull request reviews/)).toBeInTheDocument();
  });

  it("settings survive Back / Continue; Preview regenerates the files for them", async () => {
    previewImpl = optionsPreview;
    open();
    await toConfigure();
    fireEvent.click(chip("reopened"));
    fireEvent.click(screen.getByRole("radio", { name: "None (exit code only)" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(previewCalls).toHaveLength(2));
    expect((previewCalls[1] as { body: unknown }).body).toEqual({
      repo: "acme/widgets",
      target: "gha",
      triggers: ["opened", "synchronize", "reopened"],
      post_as: "none",
    });
    await waitFor(() => expect(screen.getByRole("option", { name: WORKFLOW_PATH })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# acme/widgets [opened,synchronize,reopened] none\n");
    fireEvent.click(continueButton());
    expect(chip("reopened")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: "None (exit code only)" })).toBeChecked();
  });

  it("with an edited workflow, a change asks to regenerate; Cancel keeps the option and the edit (AC-CI-10)", async () => {
    previewImpl = optionsPreview;
    open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "# my edit\n" } });
    fireEvent.click(continueButton());
    fireEvent.click(chip("reopened"));
    expect(screen.getByRole("alertdialog", { name: "Regenerate workflow?" })).toHaveTextContent("Your edits will be lost.");
    expect(chip("reopened")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chip("reopened")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# my edit\n");
    expect(previewCalls).toHaveLength(1);
  });

  it("Regenerate applies the option, drops the edit, and the new files are used", async () => {
    previewImpl = optionsPreview;
    open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "# my edit\n" } });
    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole("radio", { name: "GitHub review" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(screen.getByRole("radio", { name: "GitHub review" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(previewCalls).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("option", { name: WORKFLOW_PATH })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    expect(screen.getByRole("textbox", { name: WORKFLOW_PATH })).toHaveValue("# acme/widgets [opened,synchronize] github_review\n");
  });

  it("no edit → options change without asking", async () => {
    open();
    await toConfigure();
    fireEvent.click(chip("reopened"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(chip("reopened")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Install (AC-CI-14..17, 19, 84)", () => {
  it("offers 'Open a PR' (default) with the repo and the real file count, and the zip; the help link opens safely", async () => {
    open();
    await toInstall();
    expect(screen.getByRole("radio", { name: "Open a PR with these files" })).toBeChecked();
    expect(screen.getByText(/opens a PR in acme\/widgets titled “Add DevDigest CI review” with the 4 generated files/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Copy files as a zip" })).not.toBeChecked();
    const help = screen.getByRole("link", { name: /Need help\?/ });
    expect(help).toHaveAttribute("href", "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions");
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("changed options are generated again before Install is enabled (no stale preview)", async () => {
    previewImpl = optionsPreview;
    open();
    await toConfigure();
    fireEvent.click(chip("reopened"));
    fireEvent.click(continueButton());
    await waitFor(() => expect(installButton()).toBeEnabled());
    expect(previewCalls).toHaveLength(2);
    expect((previewCalls[1] as { body: { triggers: string[] } }).body.triggers).toEqual(["opened", "synchronize", "reopened"]);
  });

  it("PR export sends the settings and the kept edit, toasts the PR URL and closes", async () => {
    const { onClose } = open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "# kept edit\n" } });
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    await waitFor(() => expect(installButton()).toBeEnabled());
    fireEvent.click(installButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(exportCalls).toEqual([
      {
        agentId: AGENT.id,
        body: {
          repo: "acme/widgets",
          target: "gha",
          triggers: ["opened", "synchronize"],
          post_as: "pr_comment",
          files: [{ path: WORKFLOW_PATH, contents: "# kept edit\n", editable: true }],
        },
      },
    ]);
    expect(toasts).toEqual([{ kind: "success", msg: "PR ready: https://github.com/acme/widgets/pull/12" }]);
    expect(zipCalls).toEqual([]);
  });

  it("an edit made for another repo never reaches the export", async () => {
    const { onClose } = open();
    await toPreview();
    fireEvent.click(screen.getByRole("option", { name: WORKFLOW_PATH }));
    fireEvent.change(screen.getByRole("textbox", { name: WORKFLOW_PATH }), { target: { value: "# for widgets\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Target repository" }), { target: { value: "acme/api" } });
    await toInstall();
    fireEvent.click(installButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((exportCalls[0] as { body: { repo: string; files?: unknown } }).body).toEqual(expect.objectContaining({ repo: "acme/api" }));
    expect((exportCalls[0] as { body: { files?: unknown } }).body.files).toBeUndefined();
  });

  it("zip downloads with the agent's name, toasts the file and closes; no PR request", async () => {
    const { onClose } = open();
    await toInstall();
    fireEvent.click(screen.getByRole("radio", { name: "Copy files as a zip" }));
    fireEvent.click(installButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(zipCalls).toEqual([
      {
        agentId: AGENT.id,
        agentName: "Security Reviewer",
        body: { repo: "acme/widgets", target: "gha", triggers: ["opened", "synchronize"], post_as: "pr_comment" },
      },
    ]);
    expect(toasts).toEqual([{ kind: "success", msg: "Downloaded devdigest-ci-security-reviewer.zip" }]);
    expect(exportCalls).toEqual([]);
  });

  const INSTALL_ERRORS: [ApiError, string][] = [
    [new ApiError("acme/widgets already runs the agent “Perf” in CI.", 409, "ci_repo_has_agent"), "Another agent already runs in CI on this repository."],
    [new ApiError("devdigest/ci changed", 409, "ci_concurrent_change"), "Nothing was written — try again."],
    [new ApiError("An open DevDigest PR targets develop", 409, "ci_pr_base_mismatch"), "targets another base branch"],
    [new ApiError("Cannot reach the DevDigest engine", 0, "network_error"), "engine is not reachable"],
    [new ApiError("GitHub request failed (HTTP 401)", 502, "external_service_error"), "Check the token"],
  ];
  it.each(INSTALL_ERRORS)("a failed install stays on Install with the server message and a hint; Install is enabled again", async (err, hint) => {
    exportImpl = async () => Promise.reject(err);
    const { onClose } = open();
    await toInstall();
    fireEvent.click(installButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Install failed"));
    expect(screen.getByRole("alert")).toHaveTextContent(hint);
    expect(screen.getByRole("alert")).toHaveTextContent(err.message);
    expect(installButton()).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it("an unexpected error shows its message; a retry after fixing it succeeds", async () => {
    exportImpl = async () => Promise.reject(new Error("socket hang up"));
    const { onClose } = open();
    await toInstall();
    fireEvent.click(installButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("socket hang up"));
    exportImpl = async () => ({ installation: {} as CiExport["installation"], files: FILES, pr_url: "https://github.com/acme/widgets/pull/12" });
    fireEvent.click(installButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportCalls).toHaveLength(2);
  });

  it("a double click sends one request; Install and Back are disabled while it runs (AC-CI-19)", async () => {
    let resolve!: (r: CiExport) => void;
    exportImpl = () => new Promise((r) => (resolve = r));
    const { onClose } = open();
    await toInstall();
    const button = installButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(exportCalls).toHaveLength(1);
    await waitFor(() => expect(installButton()).toBeDisabled());
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Copy files as a zip" })).toBeDisabled();
    await act(async () => resolve({ installation: {} as CiExport["installation"], files: FILES, pr_url: "u" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(exportCalls).toHaveLength(1);
  });

  it("Update CI config: the fixed repo, 'Update the existing PR', and the export targets that repo (AC-CI-64)", async () => {
    const { onClose } = open({ mode: "update", repo: "acme/api", target: "gha" });
    await toInstall();
    expect(screen.getByRole("radio", { name: "Update the existing PR" })).toBeChecked();
    expect(screen.getByText(/existing devdigest\/ci PR in acme\/api/)).toBeInTheDocument();
    fireEvent.click(installButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((exportCalls[0] as { body: { repo: string } }).body.repo).toBe("acme/api");
    expect((previewCalls[0] as { body: { repo: string } }).body.repo).toBe("acme/api");
  });
});
