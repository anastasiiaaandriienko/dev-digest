/* AgentSkillRow — one skill in the agent's Skills tab: drag handle (enabled,
   attached skills only), prompt position, name, type, source, state badges,
   the per-agent switch, keyboard ↑ / ↓ and detach. All controls are siblings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Toggle } from "@devdigest/ui";
import { SOURCE_ICON, TYPE_COLOR } from "@/lib/skill-meta";
import type { SkillRow } from "../../helpers";
import { s } from "./styles";

export interface AgentSkillRowProps {
  row: SkillRow;
  /** Drag (and keyboard move) allowed: attached + enabled for this agent, no filter. */
  canReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onToggle: (on: boolean) => void;
  onDetach?: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Present on rows that accept a drop (attached rows while something is dragged). */
  onDragOver?: () => void;
  onDrop?: () => void;
}

export function AgentSkillRow({
  row,
  canReorder,
  canMoveUp,
  canMoveDown,
  dragging,
  dropTarget,
  onToggle,
  onDetach,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: AgentSkillRowProps) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const { skill } = row;
  const color = TYPE_COLOR[skill.type] ?? TYPE_COLOR.custom;
  const SourceIcon = Icon[SOURCE_ICON[skill.source] ?? "Edit"];

  return (
    <li
      data-skill-id={skill.id}
      data-applied={row.applied ? "true" : undefined}
      draggable={canReorder}
      onDragStart={(e) => {
        if (!canReorder) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", skill.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={
        onDragOver &&
        ((e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          onDragOver();
        })
      }
      onDrop={
        onDrop &&
        ((e) => {
          e.preventDefault();
          onDrop();
        })
      }
      style={s.row(row.applied, dragging, dropTarget)}
    >
      <span
        style={s.handle(canReorder)}
        title={canReorder ? t("skills.dragHandle", { name: skill.name }) : t("skills.dragDisabled")}
        aria-hidden="true"
      >
        <Icon.Menu size={14} />
      </span>
      <span className="mono tnum" style={s.position} data-testid="prompt-position">
        {row.promptOrder != null ? t("skills.promptPosition", { position: row.promptOrder }) : "–"}
      </span>
      <span className="mono" style={s.name} title={skill.name}>
        {skill.name}
      </span>
      <span style={s.typeChip(color.c, color.bg)} data-skill-type={skill.type}>
        {ts(`listItem.type.${skill.type}`)}
      </span>
      <span style={s.source} title={t("skills.source")}>
        <SourceIcon size={11} />
        {ts(`listItem.source.${skill.source}`)}
      </span>
      {row.attached && !row.agentEnabled && (
        <span style={s.badge("var(--text-muted)")} title={t("skills.offForAgentHint")} data-state="off-for-agent">
          {t("skills.offForAgent")}
        </span>
      )}
      {!row.globalEnabled && (
        <span style={s.badge("var(--warn)")} title={t("skills.offGloballyHint")} data-state="off-globally">
          {t("skills.offGlobally")}
        </span>
      )}
      <span style={s.spacer} />
      {row.attached && (
        <span style={s.moves}>
          <IconBtn
            icon="ArrowUp"
            size={24}
            label={t("skills.moveUp", { name: skill.name })}
            disabled={!canReorder || !canMoveUp}
            onClick={() => onMove(-1)}
          />
          <IconBtn
            icon="ArrowDown"
            size={24}
            label={t("skills.moveDown", { name: skill.name })}
            disabled={!canReorder || !canMoveDown}
            onClick={() => onMove(1)}
          />
        </span>
      )}
      <Toggle
        on={row.attached && row.agentEnabled}
        onChange={onToggle}
        size={14}
        label={t("skills.useForAgent", { name: skill.name })}
      />
      {onDetach && (
        <IconBtn icon="X" size={24} danger label={t("skills.detach", { name: skill.name })} onClick={onDetach} />
      )}
    </li>
  );
}
