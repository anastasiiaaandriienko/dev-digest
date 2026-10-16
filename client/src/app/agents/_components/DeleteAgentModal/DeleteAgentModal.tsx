/* DeleteAgentModal — confirm deleting an agent (HW2 #34): names the agent, says
   how many skill links go with it (the skills themselves are kept), and offers
   Delete / Cancel / X. While the request runs the dialog cannot be dismissed;
   a failed delete keeps it open with the reason (the global MutationCache
   handler also toasts it). Same design as DeleteSkillModal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useDeleteAgent } from "@/lib/hooks/agents";
import { notify } from "@/lib/toast";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function DeleteAgentModal({
  agent,
  onClose,
  onDeleted,
}: {
  agent: Pick<Agent, "id" | "name" | "skill_count">;
  onClose: () => void;
  /** Called after the server confirmed the delete. */
  onDeleted?: (id: string) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  /** null = no error; "" = failed without a message. */
  const [error, setError] = React.useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      await del.mutateAsync(agent.id);
      notify.success(t("delete.deleted", { name: agent.name }));
      onDeleted?.(agent.id);
      onClose();
    } catch (e) {
      setError((e as Error)?.message ?? "");
    }
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("delete.title")}
      onClose={del.isPending ? undefined : onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={del.isPending}>
            {t("delete.cancel")}
          </Button>
          <Button kind="danger" icon="Trash" onClick={confirm} loading={del.isPending}>
            {del.isPending ? t("delete.deleting") : t("delete.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.iconBox}>
          <Icon.AlertTriangle size={18} />
        </div>
        <div style={s.text}>
          <p style={s.lead}>{t("delete.body", { name: agent.name })}</p>
          {agent.skill_count != null && (
            <p style={s.muted} data-testid="delete-agent-skills">
              {t("delete.skills", { count: agent.skill_count })}
            </p>
          )}
          <p style={s.muted}>{t("delete.irreversible")}</p>
          {error !== null && (
            <p role="alert" style={s.error}>
              {error ? `${t("delete.failed")} ${error}` : t("delete.failed")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
