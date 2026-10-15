/* AgentCard — name, description, model chip, attached-skill count (HW2 #32),
   enabled toggle and delete (HW2 #33). Delete only asks the parent, which shows
   DeleteAgentModal (#34); the toggle and the delete button never open the agent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, IconBtn, Toggle } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  onClick,
  onToggle,
  onDelete,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
  /** Ask to delete (the parent shows the confirmation). Omit to hide the button. */
  onDelete?: () => void;
}) {
  const t = useTranslations("agents");
  const color = modelColor(ag.model);
  return (
    <div onClick={onClick} style={s.card(!!active, ag.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <span style={s.name}>{ag.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        {onDelete && (
          <div onClick={(e) => e.stopPropagation()}>
            <IconBtn icon="Trash" size={24} danger label={t("card.deleteLabel", { name: ag.name })} onClick={onDelete} />
          </div>
        )}
      </div>
      <div style={s.description}>{ag.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)}>
          {ag.model}
        </span>
        {skillCount != null && (
          <Badge color="var(--text-secondary)" icon="Sparkles">
            {t("card.skillCount", { count: skillCount })}
          </Badge>
        )}
      </div>
    </div>
  );
}
