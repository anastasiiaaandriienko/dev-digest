/* RunEvalsConfirm — explicit confirmation before a PAID eval run (spec §12.2, §12.3;
   shared by AgentEditor → Evals and the Eval Dashboard):
   which agent version, how many cases / distinct inputs (= engine calls), and
   that it makes paid LLM calls. Nothing is started until "Run evals" here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import { startErrorKey } from "@/lib/evals";
import { s } from "./styles";

export function RunEvalsConfirm({
  agentName,
  version,
  cases,
  inputs,
  onConfirm,
  onClose,
}: {
  agentName: string;
  version: number;
  cases: number;
  inputs: number;
  /** Starts the run; rejects with the API error. */
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(t(`evalsTab.startErrors.${startErrorKey(err)}`));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      width={520}
      title={t("evalsTab.confirm.title")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={pending}>
            {t("evalsTab.confirm.cancel")}
          </Button>
          <Button kind="primary" icon="Play" loading={pending} onClick={start}>
            {pending ? t("evalsTab.confirm.starting") : t("evalsTab.confirm.start")}
          </Button>
        </div>
      }
    >
      <div style={s.body} data-testid="run-evals-confirm">
        <p style={s.text}>{t("evalsTab.confirm.body", { agent: agentName, version, cases, inputs })}</p>
        <div style={s.paid} role="note">
          <Icon.AlertTriangle size={15} style={s.paidIcon} />
          <span>{t("evalsTab.confirm.paid")}</span>
        </div>
        {error && (
          <div role="alert" style={s.error}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
