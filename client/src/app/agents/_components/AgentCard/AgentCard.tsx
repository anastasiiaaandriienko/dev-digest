/* AgentCard — one agent in the Agents list column (design: Agents · AgentCard):
   icon, name, enabled toggle, delete (HW2 #33), one-line description, model
   chip and attached-skill count (HW2 #32); highlighted while open in the
   editor. The card is a plain container (a click anywhere opens the agent, as
   a mouse convenience); the keyboard / screen-reader entry is the name button.
   Toggle and delete are sibling controls and never open the agent; delete
   only asks the parent, which shows DeleteAgentModal (#34). */
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
  /** Highlighted while open in the editor. */
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
    <div
      data-agent-id={ag.id}
      data-active={active ? "true" : undefined}
      onClick={(e) => {
        // Buttons inside the card (name, toggle, delete) handle their own clicks.
        if ((e.target as HTMLElement).closest("button")) return;
        onClick?.();
      }}
      style={s.card(!!active, ag.enabled)}
    >
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <button
          type="button"
          style={s.name}
          title={ag.name}
          aria-label={t("card.open", { name: ag.name })}
          aria-current={active ? "true" : undefined}
          onClick={onClick}
        >
          {ag.name}
        </button>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} label={t("card.toggleLabel", { name: ag.name })} />
          </div>
        )}
        {onDelete && (
          <div onClick={(e) => e.stopPropagation()}>
            <IconBtn icon="Trash" size={24} danger label={t("card.deleteLabel", { name: ag.name })} onClick={onDelete} />
          </div>
        )}
      </div>
      <div style={s.description} title={ag.description || undefined}>
        {ag.description || t("card.noDescription")}
      </div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)} title={`${ag.provider}/${ag.model}`}>
          {ag.model}
        </span>
        {skillCount != null && (
          <span style={s.skills}>
            <Badge color="var(--text-secondary)" icon="Sparkles">
              {t("card.skillCount", { count: skillCount })}
            </Badge>
          </span>
        )}
      </div>
    </div>
  );
}
