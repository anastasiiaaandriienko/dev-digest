/* ImportSkillModal — "Add Skill → Import from file" (HW2 #15). Pick or drop a
   .md / .zip → the server parses it (nothing saved) → every skill found is
   shown for review and can be edited or left out → import. Imported skills are
   saved disabled ("needs vetting"); the server re-checks everything. Server
   errors are toasted by the global MutationCache handler and also shown here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import { useImportSkills, usePreviewSkillImport } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { ImportCandidate } from "./_components/ImportCandidate";
import { ACCEPT, MODAL_WIDTH } from "./constants";
import {
  MAX_UPLOAD_MB,
  applyImportError,
  draftIssues,
  draftsFrom,
  editDraft,
  fileProblem,
  itemsToImport,
  readAsBase64,
  rejectedEntries,
  type DraftPatch,
  type ImportDraft,
} from "./helpers";
import { s } from "./styles";

interface FileError {
  message: string;
  entries: { path: string; reason: string }[];
}

export function ImportSkillModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** Called with the created (disabled) skills. */
  onImported?: (skills: Skill[]) => void;
}) {
  const t = useTranslations("skills.importFile");
  const previewFile = usePreviewSkillImport();
  const importSkills = useImportSkills();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const [reading, setReading] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<FileError | null>(null);
  const [preview, setPreview] = React.useState<SkillImportPreview | null>(null);
  const [drafts, setDrafts] = React.useState<ImportDraft[]>([]);

  const duplicate = (name: string) => t("errors.duplicateInFile", { name });
  const issues = drafts.map((_, i) => draftIssues(drafts, i, duplicate));
  const included = drafts.filter((d) => d.include).length;
  const blocked = included === 0 || issues.some((list) => list.length > 0) || importSkills.isPending;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    const problem = fileProblem(file);
    if (problem) {
      setFileError({ message: t(`errors.${problem}`, { size: MAX_UPLOAD_MB }), entries: [] });
      return;
    }
    setReading(file.name);
    try {
      const content_base64 = await readAsBase64(file).catch(() => {
        throw new Error(t("errors.read"));
      });
      const result = await previewFile.mutateAsync({ filename: file.name, content_base64 });
      setPreview(result);
      setDrafts(draftsFrom(result.items));
    } catch (e) {
      setFileError({ message: (e as Error).message || t("errors.failed"), entries: rejectedEntries(e) });
    } finally {
      setReading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const change = (index: number, patch: DraftPatch) =>
    setDrafts((list) => list.map((d, i) => (i === index ? editDraft(d, patch) : d)));

  const reset = () => {
    setPreview(null);
    setDrafts([]);
    setFileError(null);
  };

  const submit = async () => {
    if (blocked) return;
    try {
      const created = await importSkills.mutateAsync(itemsToImport(drafts));
      notify.success(t("success", { count: created.length }));
      onClose();
      onImported?.(created);
    } catch (e) {
      // Toasted globally; put the reasons (taken names, field issues) on the drafts.
      setDrafts((list) => applyImportError(list, e, (name) => t("errors.taken", { name })));
    }
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("title")}
      subtitle={t("subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {preview && (
            <Button kind="ghost" icon="Upload" onClick={reset} disabled={importSkills.isPending}>
              {t("chooseAnother")}
            </Button>
          )}
          <span style={s.footerSpacer} />
          <Button kind="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          {preview && (
            <Button kind="primary" icon="Check" onClick={submit} disabled={blocked}>
              {importSkills.isPending ? t("importing") : t("submit", { count: included })}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {!preview && (
          <div
            style={s.drop(over)}
            data-testid="import-drop-zone"
            aria-busy={reading ? "true" : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void pick(e.dataTransfer.files[0]);
            }}
          >
            <Icon.Upload size={22} style={s.dropIcon} />
            {reading ? (
              <span style={s.dropText}>{t("reading", { filename: reading })}</span>
            ) : (
              <span style={s.dropText}>
                {t("drop")}{" "}
                <button type="button" style={s.browse} onClick={() => inputRef.current?.click()}>
                  {t("browse")}
                </button>
              </span>
            )}
            <span style={s.hint}>{t("dropHint", { size: MAX_UPLOAD_MB })}</span>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              aria-label={t("inputLabel")}
              style={s.hiddenInput}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </div>
        )}

        {fileError && (
          <div role="alert" style={s.error}>
            <div style={s.errorTitle}>{t("errors.failed")}</div>
            <div>{fileError.message}</div>
            {fileError.entries.length > 0 && (
              <ul style={s.entries} aria-label={t("rejectedEntries")}>
                {fileError.entries.map((e) => (
                  <li key={`${e.path}:${e.reason}`}>
                    <span className="mono">{e.path}</span>: {e.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {preview && (
          <>
            <div style={s.summary}>
              <Icon.FileText size={14} />
              <span>{t("found", { count: preview.items.length, filename: preview.filename })}</span>
              {preview.skipped.length > 0 && <span>· {t("skipped", { count: preview.skipped.length })}</span>}
            </div>
            <div style={s.vetting}>
              <Icon.Shield size={14} />
              <span>{t("vetting")}</span>
            </div>
            <ul style={s.list} data-testid="import-candidates">
              {drafts.map((d, i) => (
                <ImportCandidate key={d.path} draft={d} issues={issues[i]!} onChange={(patch) => change(i, patch)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
