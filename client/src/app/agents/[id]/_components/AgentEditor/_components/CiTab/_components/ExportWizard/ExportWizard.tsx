/* ExportWizard — "Export to CI · Run <agent> automatically on pull requests" (L07,
   specs/export-to-ci.md §6.3; AC-CI-01..08, 18, 63, 64, 83). Four steps shown by
   ExportWizardSteps: Target and Preview here; Configure and Install follow (B12).
   State lives in a reducer inside the modal: × / Esc / backdrop discard it, and nothing
   is written before Install. The preview is generated when Preview opens and again
   only when its inputs changed; workflow edits survive Back / Continue. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCiPreview, useRepoCiInstallations } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import type { CiWizardRequest } from "../../helpers";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { STEP_KEYS } from "./constants";
import {
  exportBody,
  initialState,
  occupyingInstallation,
  previewKey,
  shownFiles,
  wizardReducer,
  workflowOverLimit,
} from "./helpers";
import { s } from "./styles";

/** Steps the wizard can reach so far: Configure and Install arrive in B12. */
const LAST_AVAILABLE_STEP = 1;

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
    if (state.step === 1 && state.filesKey !== key && !generating && failedKey !== key) runPreview();
  }, [state.step, state.filesKey, key, generating, failedKey, runPreview]);

  const failed = failedKey === key && preview.isError;
  const overLimit = workflowOverLimit(state);
  const previewReady = state.files !== null && state.filesKey === key && !failed;
  const valid =
    state.step === 0
      ? !!state.repo && state.target === "gha" && repoQ.isSuccess && !occupiedBy
      : state.step === 1
        ? previewReady && overLimit === null
        : false;
  const reachable = state.step < LAST_AVAILABLE_STEP;

  return (
    <Modal
      width={860}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {!reachable && state.step === LAST_AVAILABLE_STEP && (
            <span style={s.footerNote}>{t("exportWizard.nextStepsSoon")}</span>
          )}
          <div style={s.footerRight}>
            {state.step > 0 && (
              <Button kind="ghost" onClick={() => dispatch({ type: "back" })}>
                {t("exportWizard.back")}
              </Button>
            )}
            <Button
              kind="primary"
              disabled={!valid || !reachable}
              title={!reachable ? t("exportWizard.nextStepsSoon") : undefined}
              onClick={() => dispatch({ type: "next" })}
            >
              {t("exportWizard.continue")}
            </Button>
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
      </div>
    </Modal>
  );
}
