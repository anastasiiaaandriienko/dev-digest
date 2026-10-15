/* SkillCard — one skill in the Skills Lab list (HW2 #9, #22, #23; design:
   Skills Lab card): type icon, name, enabled toggle, description, type + source ("needs vetting" while an untrusted import is
   still disabled), agent count and version.
   The card is a plain container (a click anywhere opens the skill, as a mouse
   convenience); the keyboard / screen-reader entry is the name button. The
   toggle is a sibling control, so no interactive element is nested in
   another, and it never opens the skill (same pattern as PRRow). Deleting a
   skill lives in the editor's Config danger zone. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { needsVetting } from "@/lib/skill-meta";
import { SOURCE_ICON, TYPE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onOpen,
  onToggle,
}: {
  skill: Skill;
  /** Highlighted while its preview is open. */
  active?: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
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
          aria-label={t("card.open", { name: skill.name })}
          aria-current={active ? "true" : undefined}
          onClick={onOpen}
        >
          {skill.name}
        </button>
        {/* Its own control: toggling must never open the skill. */}
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle
            on={skill.enabled}
            onChange={onToggle}
            size={14}
            label={t("card.toggleLabel", { name: skill.name })}
          />
        </div>
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
        {needsVetting(skill) && (
          <span style={s.vetting} title={t("listItem.vettingTitle")} data-testid="needs-vetting">
            <Icon.Shield size={10} />
            {t("listItem.needsVetting")}
          </span>
        )}
      </div>
      <div style={s.footer}>
        <span className="tnum" style={s.footerItem} data-testid="skill-agent-count">
          <Icon.Cpu size={11} />
          {t("card.agents", { count: skill.agent_count })}
        </span>
        <span className="tnum" style={s.footerItem} data-testid="skill-version">
          <Icon.GitCommit size={11} />
          {t("preview.version", { version: skill.version })}
        </span>
      </div>
    </div>
  );
}
