/* UnsavedChangesModal — asked before leaving a skill whose Config has unsaved
   edits (another skill in the list, or an agent link on the Stats tab). Three ways out:
   Save and continue (only leaves once the save succeeded), Discard changes
   (leave without saving) and Cancel / X (stay, edits untouched). While the
   save runs the dialog can't be dismissed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal } from "@devdigest/ui";
import { MODAL_WIDTH } from "./constants";
import { s } from "./styles";

export function UnsavedChangesModal({
  name,
  saving,
  onSave,
  onDiscard,
  onCancel,
}: {
  /** The skill being left. */
  name: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("skills");
  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("unsaved.title")}
      onClose={saving ? undefined : onCancel}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onCancel} disabled={saving}>
            {t("unsaved.cancel")}
          </Button>
          <Button kind="secondary" onClick={onDiscard} disabled={saving}>
            {t("unsaved.discard")}
          </Button>
          <Button kind="primary" icon="Check" onClick={onSave} disabled={saving}>
            {saving ? t("unsaved.saving") : t("unsaved.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.iconBox}>
          <Icon.AlertTriangle size={18} />
        </div>
        <div style={s.text}>
          <p style={s.lead}>{t("unsaved.body", { name })}</p>
          <p style={s.muted}>{t("unsaved.hint")}</p>
        </div>
      </div>
    </Modal>
  );
}
