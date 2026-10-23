/* AddToEvalModal — "Turn into eval case" from a decided finding (L06, spec §7,
   §12.1; design `EvalCaseEditor` seeded variant). Shows the label the server
   will derive (accepted → must find, dismissed → must not flag), the assertion
   and the expected output; the user edits only name + notes. The diff and PR
   metadata are frozen on the server. Mounted only while open, so its mutation
   hook never runs on a plain card render. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, Textarea, TextInput } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { existingEvalCaseId, useCreateEvalCase } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import {
  defaultCaseName,
  errorKeyOf,
  evalCaseBody,
  evalKindOf,
  expectedPreview,
  locationOf,
  validateEvalCaseForm,
} from "./helpers";
import { s } from "./styles";

export function AddToEvalModal({ finding, onClose }: { finding: FindingRecord; onClose: () => void }) {
  const t = useTranslations("prReview");
  const kind = evalKindOf(finding) ?? "must_find";
  const create = useCreateEvalCase();
  const [name, setName] = React.useState(() => defaultCaseName(kind, finding.title));
  const [notes, setNotes] = React.useState("");
  const [apiError, setApiError] = React.useState<string | null>(null);

  const errors = validateEvalCaseForm({ name, notes });
  const invalid = !!errors.name || !!errors.notes;
  const location = locationOf(finding);
  const negative = kind === "must_not_flag";

  const save = async () => {
    if (invalid || create.isPending) return;
    setApiError(null);
    try {
      await create.mutateAsync({ findingId: finding.id, body: evalCaseBody({ name, notes }) });
      notify.success(t("finding.evalCase.created", { kind: t(`finding.evalCase.kind.${kind}`) }));
      onClose();
    } catch (err) {
      if (existingEvalCaseId(err)) {
        // The hook already marked the card "In eval set".
        notify.info(t("finding.evalCase.alreadyExists"));
        onClose();
        return;
      }
      setApiError(t(`finding.evalCase.errors.${errorKeyOf(err)}`));
    }
  };

  return (
    <Modal
      width={680}
      title={t("finding.evalCase.modal.title")}
      subtitle={t(negative ? "finding.evalCase.modal.subtitleMustNotFlag" : "finding.evalCase.modal.subtitleMustFind")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("finding.evalCase.modal.cancel")}
          </Button>
          <Button kind="primary" icon="Check" disabled={invalid} loading={create.isPending} onClick={save}>
            {create.isPending ? t("finding.evalCase.modal.saving") : t("finding.evalCase.modal.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body} data-testid="add-to-eval-modal">
        <div style={s.banner(kind)}>
          {negative ? <Icon.XCircle size={15} style={s.bannerIcon(kind)} /> : <Icon.Target size={15} style={s.bannerIcon(kind)} />}
          <span style={s.bannerText}>
            <b style={s.bannerKind(kind)}>
              {t(negative ? "finding.evalCase.modal.negative" : "finding.evalCase.modal.positive")}
            </b>
            {t(negative ? "finding.evalCase.modal.assertionMustNotFlag" : "finding.evalCase.modal.assertionMustFind", {
              title: finding.title,
              location,
            })}
          </span>
        </div>

        <FormField label={t("finding.evalCase.modal.nameLabel")} hint={t("finding.evalCase.modal.nameHint")} required>
          <TextInput
            value={name}
            onChange={(v) => setName(v)}
            mono
            aria-label={t("finding.evalCase.modal.nameLabel")}
            aria-invalid={!!errors.name}
          />
          {errors.name && (
            <div role="alert" style={s.fieldError}>
              {t(`finding.evalCase.validation.${errors.name}`)}
            </div>
          )}
        </FormField>

        <FormField label={t("finding.evalCase.modal.notesLabel")} hint={t("finding.evalCase.modal.notesHint")}>
          <Textarea value={notes} onChange={(v) => setNotes(v)} rows={3} aria-label={t("finding.evalCase.modal.notesLabel")} />
          {errors.notes && (
            <div role="alert" style={s.fieldError}>
              {t(`finding.evalCase.validation.${errors.notes}`)}
            </div>
          )}
        </FormField>

        <div style={s.expectedLabel}>{t("finding.evalCase.modal.expectedLabel")}</div>
        <pre className="mono" style={s.expected} data-testid="eval-expected">
          {negative ? t("finding.evalCase.modal.expectedEmpty") : expectedPreview(finding)}
        </pre>
        <div style={s.frozenNote}>{t("finding.evalCase.modal.frozenNote")}</div>

        {apiError && (
          <div role="alert" style={s.apiError} data-testid="eval-case-error">
            {apiError}
          </div>
        )}
      </div>
    </Modal>
  );
}
