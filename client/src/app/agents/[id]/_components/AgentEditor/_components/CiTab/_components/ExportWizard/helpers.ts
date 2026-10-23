import type { CiExportInputBody, CiFile, CiInstallationView, CiPostAs, CiTarget, CiTrigger } from "@devdigest/shared";
import type { CiWizardRequest } from "../../helpers";
import { DEFAULT_POST_AS, DEFAULT_TRIGGERS, MAX_WORKFLOW_BYTES, WORKFLOW_PATH } from "./constants";

/** 0 Target · 1 Preview · 2 Configure · 3 Install. */
export type WizardStep = 0 | 1 | 2 | 3;

/**
 * Everything the wizard collected. It lives only while the modal is open, so
 * closing it (× / Esc / backdrop) discards it (AC-CI-18); nothing is written
 * before Install.
 */
export interface WizardState {
  step: WizardStep;
  mode: CiWizardRequest["mode"];
  repo: string;
  target: CiTarget;
  triggers: CiTrigger[];
  postAs: CiPostAs;
  /** Last preview result, and the inputs it was generated for. */
  files: CiFile[] | null;
  filesKey: string | null;
  /** The user's version of the workflow; null = the generated one (AC-CI-07). Kept across
      Back / Continue and Retry; dropped when another repository is chosen. */
  editedWorkflow: string | null;
  selectedPath: string | null;
}

export type WizardAction =
  | { type: "setRepo"; repo: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "previewLoaded"; files: CiFile[]; key: string }
  | { type: "selectFile"; path: string }
  | { type: "editWorkflow"; text: string };

export function initialState(request: CiWizardRequest, activeRepo: string | null): WizardState {
  return {
    step: 0,
    mode: request.mode,
    repo: request.mode === "update" ? request.repo : (activeRepo ?? ""),
    target: request.mode === "update" ? request.target : "gha",
    triggers: [...DEFAULT_TRIGGERS],
    postAs: DEFAULT_POST_AS,
    files: null,
    filesKey: null,
    editedWorkflow: null,
    selectedPath: null,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "setRepo":
      // The repo of an installation being updated is fixed (AC-CI-64). Another repo drops
      // the workflow edit: an edit made for one repository never reaches another's export.
      if (state.mode === "update" || action.repo === state.repo) return state;
      return { ...state, repo: action.repo, editedWorkflow: null };
    case "next":
      return { ...state, step: Math.min(3, state.step + 1) as WizardStep };
    case "back":
      return { ...state, step: Math.max(0, state.step - 1) as WizardStep };
    case "previewLoaded": {
      const keep = state.selectedPath && action.files.some((f) => f.path === state.selectedPath);
      return {
        ...state,
        files: action.files,
        filesKey: action.key,
        selectedPath: keep ? state.selectedPath : (action.files[0]?.path ?? null),
      };
    }
    case "selectFile":
      return { ...state, selectedPath: action.path };
    case "editWorkflow":
      return { ...state, editedWorkflow: action.text };
  }
}

/** The inputs a preview depends on: a different key means the files must be generated again. */
export function previewKey(state: Pick<WizardState, "repo" | "target" | "triggers" | "postAs">): string {
  return JSON.stringify([state.repo, state.target, [...state.triggers].sort(), state.postAs]);
}

/** The request body for preview / export / zip, carrying the edited workflow (AC-CI-07, 17). */
export function exportBody(state: WizardState): CiExportInputBody {
  return {
    repo: state.repo,
    target: state.target,
    triggers: state.triggers,
    post_as: state.postAs,
    ...(state.editedWorkflow !== null
      ? { files: [{ path: WORKFLOW_PATH, contents: state.editedWorkflow, editable: true }] }
      : {}),
  };
}

/** The files to show: the preview with the workflow replaced by the user's edit. */
export function shownFiles(state: Pick<WizardState, "files" | "editedWorkflow">): CiFile[] {
  return (state.files ?? []).map((f) =>
    f.path === WORKFLOW_PATH && state.editedWorkflow !== null ? { ...f, contents: state.editedWorkflow } : f,
  );
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Over the 64 KB limit → the size in bytes, else null (AC-CI-83). */
export function workflowOverLimit(state: Pick<WizardState, "editedWorkflow">): number | null {
  if (state.editedWorkflow === null) return null;
  const bytes = utf8Bytes(state.editedWorkflow);
  return bytes > MAX_WORKFLOW_BYTES ? bytes : null;
}

/** Another agent's installation occupying the repo (pending, active or error; AC-CI-05, G2). */
export function occupyingInstallation(
  installations: readonly CiInstallationView[] | undefined,
  agentId: string,
): CiInstallationView | null {
  return installations?.find((i) => i.agent_id !== agentId) ?? null;
}
