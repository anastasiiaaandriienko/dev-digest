/* DeleteSkillModal — confirm deleting a skill (HW2 #24): names the skill, says
   how many agents lose it (the agents themselves are kept), and offers
   Delete / Cancel / X. Used from the Skills grid (and later the skill page).
   Server errors are toasted by the global MutationCache handler. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function DeleteSkillModal({
  skill,
  onClose,
  onDeleted,
}: {
  skill: Pick<Skill, "id" | "name" | "agent_count">;
  onClose: () => void;
  /** Called after the server confirmed the delete. */
  onDeleted?: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const del = useDeleteSkill();

  const confirm = async () => {
    try {
      await del.mutateAsync(skill.id);
      notify.success(t("delete.deleted", { name: skill.name }));
      onDeleted?.(skill.id);
      onClose();
    } catch {
      // The global MutationCache onError already shows the toast; keep the dialog.
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
          <Button kind="danger" icon="Trash" onClick={confirm} disabled={del.isPending}>
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
          <p style={s.lead}>{t("delete.body", { name: skill.name })}</p>
          <p style={s.muted} data-testid="delete-skill-usage">
            {t("delete.usage", { count: skill.agent_count })}
          </p>
          <p style={s.muted}>{t("delete.irreversible")}</p>
        </div>
      </div>
    </Modal>
  );
}
