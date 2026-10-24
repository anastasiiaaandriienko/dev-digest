/* ExportWizard — "Export to CI · Run <agent> automatically on pull requests" (L07,
   specs/export-to-ci.md §6.3; AC-CI-01..19, 63, 64, 79, 83, 84). Four steps shown by
   ExportWizardSteps: Target → Preview → Configure → Install. State lives in a reducer
   inside the modal: × / Esc / backdrop discard it, and nothing is written before
   Install. The preview is generated for the current repo + options (on Preview and
   again on Install when they changed); a workflow edit survives Back / Continue and
   Retry, and is dropped when the repo or an option changes (after a confirmation in
   Configure). Install opens / updates the PR or downloads the zip — once per click. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { safeGithubUrl } from "@/lib/github-urls";
import { useCiPreview, useExportCi, useExportCiZip, useRepoCiInstallations } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import type { CiWizardRequest } from "../../helpers";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep, type InstallError, type InstallMethod } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { STEP_KEYS } from "./constants";
import {
  exportBody,
  initialState,
  occupyingInstallation,
  optionsValid,
  previewKey,
  shownFiles,
  wizardReducer,
  workflowOverLimit,
} from "./helpers";
import { s } from "./styles";

/** Steps that need files generated for the current inputs: Preview and Install. */
const NEEDS_FILES = new Set([1, 3]);

function toInstallError(err: unknown): InstallError {
  if (err instanceof ApiError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err) };
}

export function ExportWizard({
  agent,
  request,
  onClose,
}: {
  agent: Agent;
  request: CiWizardRequest;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const { activeRepo, repos } = useActiveRepo();
  const [state, dispatch] = React.useReducer(wizardReducer, undefined, () =>
    initialState(request, activeRepo?.full_name ?? null),
  );

  // Esc closes like × (AC-CI-18).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const repoQ = useRepoCiInstallations(state.repo || null);
  const occupiedBy = occupyingInstallation(repoQ.data, agent.id);

  // Preview: generated for the current inputs, without the user's edit (shown on top).
  const preview = useCiPreview();
  const key = previewKey(state);
  const { mutate: generate, isPending: generating } = preview;
  /** The inputs the last failed preview was for: an error blocks only those (Retry or a change re-runs). */
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  const runPreview = React.useCallback(() => {
    const body = exportBody({ ...state, editedWorkflow: null });
    setFailedKey(null);
    generate(
      { agentId: agent.id, body },
      {
        onSuccess: (res) => dispatch({ type: "previewLoaded", files: res.files, key }),
        onError: () => setFailedKey(key),
      },
    );
  }, [agent.id, generate, key, state]);
  React.useEffect(() => {
    if (NEEDS_FILES.has(state.step) && state.filesKey !== key && !generating && failedKey !== key) runPreview();
  }, [state.step, state.filesKey, key, generating, failedKey, runPreview]);

  // Install (AC-CI-14..17, 19): one request per click, errors stay on the step.
  const exportPr = useExportCi();
  const exportZip = useExportCiZip();
  const [method, setMethod] = React.useState<InstallMethod>("pr");
  const [installError, setInstallError] = React.useState<InstallError | null>(null);
  const inFlight = React.useRef(false);
  const installing = exportPr.isPending || exportZip.isPending;

  const failed = failedKey === key && preview.isError;
  const overLimit = workflowOverLimit(state);
  const previewReady = state.files !== null && state.filesKey === key && !failed;
  const valid =
    state.step === 0
      ? !!state.repo && state.target === "gha" && repoQ.isSuccess && !occupiedBy
      : state.step === 1
        ? previewReady && overLimit === null
        : state.step === 2
          ? optionsValid(state)
          : previewReady && overLimit === null && optionsValid(state) && !installing;

  const install = () => {
    if (inFlight.current || !valid) return;
    inFlight.current = true;
    setInstallError(null);
    const body = exportBody(state);
    const settle = { onSettled: () => void (inFlight.current = false) };
    const fail = (err: unknown) => setInstallError(toInstallError(err));
    if (method === "pr") {
      exportPr.mutate(
        { agentId: agent.id, body },
        {
          ...settle,
          onSuccess: (res) => {
            // AC-CI-15: the toast links the PR, but only a github.com https URL from the API.
            const prUrl = safeGithubUrl(res.pr_url);
            notify.success(
              t("exportWizard.prOpened", { repo: body.repo }),
              prUrl ? { link: { href: prUrl, label: t("exportWizard.viewPr") } } : undefined,
            );
            onClose();
          },
          onError: fail,
        },
      );
    } else {
      exportZip.mutate(
        { agentId: agent.id, agentName: agent.name, body },
        {
          ...settle,
          onSuccess: (res) => {
            notify.success(t("exportWizard.zipDownloaded", { filename: res.filename }));
            onClose();
          },
          onError: fail,
        },
      );
    }
  };

  return (
    <Modal
      width={860}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <div style={s.footerRight}>
            {state.step > 0 && (
              <Button kind="ghost" disabled={installing} onClick={() => dispatch({ type: "back" })}>
                {t("exportWizard.back")}
              </Button>
            )}
            {state.step < 3 ? (
              <Button kind="primary" disabled={!valid} onClick={() => dispatch({ type: "next" })}>
                {t("exportWizard.continue")}
              </Button>
            ) : (
              <Button kind="primary" disabled={!valid} loading={installing} onClick={install}>
                {installing ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={s.steps}>
        <ExportWizardSteps step={state.step} labels={STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`))} />
      </div>
      <div style={s.body}>
        {state.step === 0 && (
          <TargetStep
            mode={state.mode}
            repo={state.repo}
            repos={repos.map((r) => r.full_name)}
            target={state.target}
            onRepo={(repo) => dispatch({ type: "setRepo", repo })}
            occupiedBy={occupiedBy}
            checking={!!state.repo && repoQ.isLoading}
            checkFailed={repoQ.isError}
          />
        )}
        {state.step === 1 && (
          <PreviewStep
            files={state.filesKey === key ? shownFiles(state) : []}
            selectedPath={state.selectedPath}
            onSelect={(path) => dispatch({ type: "selectFile", path })}
            onEditWorkflow={(text) => dispatch({ type: "editWorkflow", text })}
            loading={generating || (state.filesKey !== key && !failed)}
            error={failed ? ((preview.error as Error)?.message ?? "") : null}
            onRetry={runPreview}
            overLimitBytes={overLimit}
          />
        )}
        {state.step === 2 && (
          <ConfigureStep
            triggers={state.triggers}
            postAs={state.postAs}
            failOn={agent.ci_fail_on}
            workflowEdited={state.editedWorkflow !== null}
            onChange={(change) => dispatch({ type: "setOptions", ...change })}
          />
        )}
        {state.step === 3 && (
          <InstallStep
            mode={state.mode}
            repo={state.repo}
            fileCount={previewReady ? shownFiles(state).length : null}
            method={method}
            onMethod={(m) => {
              setMethod(m);
              setInstallError(null);
            }}
            disabled={installing}
            error={installError ?? (failed ? { message: (preview.error as Error)?.message ?? "" } : null)}
          />
        )}
      </div>
    </Modal>
  );
}
