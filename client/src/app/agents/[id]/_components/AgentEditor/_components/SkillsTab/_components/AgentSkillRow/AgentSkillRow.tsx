/* AgentSkillRow — one skill in the agent's Skills tab (design: Agent Editor ·
   Skills row): drag handle (enabled, attached skills only), the per-agent
   checkbox, name, state badges, type chip, keyboard ↑ / ↓ and detach. All
   controls are siblings. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn } from "@devdigest/ui";
import { TYPE_COLOR } from "@/lib/skill-meta";
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
  const on = row.attached && row.agentEnabled;

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
      {/* Not the kit Checkbox: that one cannot carry an accessible name (aria-label). */}
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        aria-label={t("skills.useForAgent", { name: skill.name })}
        onClick={() => onToggle(!on)}
        style={s.checkbox(on)}
      >
        {on && <Icon.Check size={11} style={s.checkMark} />}
      </button>
      <span className="mono" style={s.name} title={skill.name}>
        {skill.name}
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
      {onDetach && (
        <IconBtn icon="X" size={24} danger label={t("skills.detach", { name: skill.name })} onClick={onDetach} />
      )}
      <span style={s.typeChip(color.c, color.bg)} data-skill-type={skill.type}>
        {ts(`listItem.type.${skill.type}`)}
      </span>
    </li>
  );
}
