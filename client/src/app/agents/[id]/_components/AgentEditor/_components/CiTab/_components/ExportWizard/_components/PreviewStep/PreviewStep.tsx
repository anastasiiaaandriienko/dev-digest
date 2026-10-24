/* PreviewStep — wizard step 2 (AC-CI-06..08, 83): "FILES TO CREATE" with every returned
   path, the selected file's contents, only the workflow editable ("editable" tag), the
   64 KB limit for the edited workflow, and loading / error + Retry. File contents are
   rendered as text; the large runner bundle is shown truncated. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton, Textarea } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { MAX_WORKFLOW_BYTES, PREVIEW_MAX_CHARS, WORKFLOW_PATH } from "../../constants";
import { s } from "./styles";

export function PreviewStep({
  files,
  selectedPath,
  onSelect,
  onEditWorkflow,
  loading,
  error,
  onRetry,
  overLimitBytes,
}: {
  /** Files to show (the workflow already carries the user's edit). */
  files: readonly CiFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onEditWorkflow: (text: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  overLimitBytes: number | null;
}) {
  const t = useTranslations("ci");
  if (loading && files.length === 0) {
    return (
      <div aria-busy="true">
        <div style={s.note}>{t("exportWizard.generating")}</div>
        <Skeleton height={240} />
      </div>
    );
  }
  if (error) {
    return <ErrorState title={t("exportWizard.previewError")} body={error} onRetry={onRetry} />;
  }
  const selected = files.find((f) => f.path === selectedPath) ?? files[0];

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.listTitle}>
          {t("exportWizard.filesToCreate")} · {t("exportWizard.fileCount", { count: files.length })}
        </div>
        <div style={s.list} role="listbox" aria-label={t("exportWizard.filesToCreate")}>
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              role="option"
              aria-selected={f.path === selected?.path}
              style={s.file(f.path === selected?.path)}
              onClick={() => onSelect(f.path)}
            >
              {f.path}
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div style={s.pane}>
          <div style={s.paneHead}>
            <span>{selected.path}</span>
            {selected.path === WORKFLOW_PATH ? (
              <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                {t("exportWizard.editable")}
              </Badge>
            ) : (
              <Badge>{t("exportWizard.readOnly")}</Badge>
            )}
          </div>
          {selected.path === WORKFLOW_PATH ? (
            <>
              <Textarea mono rows={18} aria-label={WORKFLOW_PATH} value={selected.contents} onChange={onEditWorkflow} />
              {overLimitBytes !== null && (
                <div style={s.limit} role="alert">
                  {t("exportWizard.workflowTooLarge", { bytes: overLimitBytes, limit: MAX_WORKFLOW_BYTES })}
                </div>
              )}
            </>
          ) : (
            <>
              <pre style={s.code} data-testid="wizard-file-contents">
                {selected.contents.length > PREVIEW_MAX_CHARS ? selected.contents.slice(0, PREVIEW_MAX_CHARS) : selected.contents}
              </pre>
              {selected.contents.length > PREVIEW_MAX_CHARS && (
                <div style={s.note}>
                  {t("exportWizard.truncated", { shown: PREVIEW_MAX_CHARS, total: selected.contents.length })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
