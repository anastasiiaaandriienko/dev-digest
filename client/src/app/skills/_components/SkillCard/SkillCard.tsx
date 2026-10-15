/* SkillCard — one skill in the Skills grid (HW2 #9, #22, #23): type icon, name,
   enabled toggle, delete, description, type + source, version and agent count.
   The card is a plain container (a click anywhere opens the preview, as a mouse
   convenience); the keyboard / screen-reader entry is the name button. The
   toggle and delete buttons are sibling controls, so no interactive element is
   nested in another, and neither ever opens the preview (same pattern as PRRow). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SOURCE_ICON, TYPE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onOpen,
  onToggle,
  onDelete,
}: {
  skill: Skill;
  /** Highlighted while its preview is open. */
  active?: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  /** Ask to delete (the parent shows the confirmation). Omit to hide the button. */
  onDelete?: () => void;
}) {
  const t = useTranslations("skills");
  const color = TYPE_COLOR[skill.type] ?? TYPE_COLOR.custom;
  const SourceIcon = Icon[SOURCE_ICON[skill.source] ?? "Edit"];

  return (
    <div
      data-skill-id={skill.id}
      data-active={active ? "true" : undefined}
      onClick={(e) => {
        // Buttons inside the card (name, toggle) handle their own clicks.
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      style={s.card(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <div style={s.iconBox(color.c, color.bg)}>
          <Icon.Sparkles size={14} />
        </div>
        <button
          type="button"
          className="mono"
          style={s.name}
          title={skill.name}
          aria-label={t("card.openPreview", { name: skill.name })}
          aria-expanded={!!active}
          onClick={onOpen}
        >
          {skill.name}
        </button>
        {/* Its own control: toggling must never open the preview. */}
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle
            on={skill.enabled}
            onChange={onToggle}
            size={14}
            label={t("card.toggleLabel", { name: skill.name })}
          />
        </div>
        {onDelete && (
          <div onClick={(e) => e.stopPropagation()}>
            <IconBtn icon="Trash" size={24} danger label={t("card.deleteLabel", { name: skill.name })} onClick={onDelete} />
          </div>
        )}
      </div>
      <div style={s.description} title={skill.description || undefined}>
        {skill.description || t("card.noDescription")}
      </div>
      <div style={s.metaRow}>
        <span style={s.typeChip(color.c, color.bg)} data-skill-type={skill.type}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <span style={s.source}>
          <SourceIcon size={11} />
          {t(`listItem.source.${skill.source}`)}
        </span>
      </div>
      <div style={s.footer}>
        <span className="tnum" style={s.footerItem} data-testid="skill-version">
          <Icon.GitCommit size={11} />
          {t("preview.version", { version: skill.version })}
        </span>
        <span className="tnum" style={s.footerItem} data-testid="skill-agent-count">
          <Icon.Cpu size={11} />
          {t("card.agents", { count: skill.agent_count })}
        </span>
      </div>
    </div>
  );
}
