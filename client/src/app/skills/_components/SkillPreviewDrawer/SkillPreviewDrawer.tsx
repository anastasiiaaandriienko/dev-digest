/* SkillPreviewDrawer — read-only preview of one skill in a right-side Drawer
   (HW2 #10): metadata plus the body rendered as Markdown (not raw text).
   Opened from the Skills grid via `?preview=<id>`; Escape or the X closes it.
   "Open skill" goes to the full page (/skills/:id, #25). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Icon, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SOURCE_ICON, TYPE_COLOR } from "../../constants";
import { DRAWER_WIDTH } from "./constants";
import { s } from "./styles";

export function SkillPreviewDrawer({
  skill,
  onClose,
  onOpenPage,
}: {
  /** null = the id in the URL matches no skill (deleted, or a bad link). */
  skill: Skill | null;
  onClose: () => void;
  /** Navigate to the skill page; omit to hide the "Open skill" action. */
  onOpenPage?: (id: string) => void;
}) {
  const t = useTranslations("skills");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!skill) {
    return (
      <Drawer width={DRAWER_WIDTH} title={t("previewDrawer.notFound")} onClose={onClose}>
        <span style={s.muted}>{t("detail.notFound.body")}</span>
      </Drawer>
    );
  }

  const color = TYPE_COLOR[skill.type] ?? TYPE_COLOR.custom;
  const SourceIcon = Icon[SOURCE_ICON[skill.source] ?? "Edit"];
  const type = t(`listItem.type.${skill.type}`);
  const source = t(`listItem.source.${skill.source}`);

  return (
    <Drawer
      width={DRAWER_WIDTH}
      title={
        <span style={s.title}>
          <span style={s.iconBox(color.c, color.bg)}>
            <Icon.Sparkles size={14} />
          </span>
          <span className="mono">{skill.name}</span>
        </span>
      }
      subtitle={t("previewDrawer.subtitle", { type, source })}
      onClose={onClose}
      footer={
        onOpenPage && (
          <div style={s.footer}>
            <Button kind="primary" icon="ArrowRight" onClick={() => onOpenPage(skill.id)}>
              {t("previewDrawer.openSkill")}
            </Button>
          </div>
        )
      }
    >
      {skill.description && <p style={s.description}>{skill.description}</p>}

      <dl style={s.meta}>
        <dt style={s.metaLabel}>{t("previewDrawer.status")}</dt>
        <dd style={s.metaValue}>
          <Badge dot color={skill.enabled ? "var(--ok)" : "var(--text-muted)"} bg="transparent">
            {t(skill.enabled ? "preview.enabled" : "preview.disabled")}
          </Badge>
        </dd>
        <dt style={s.metaLabel}>{t("previewDrawer.version")}</dt>
        <dd style={s.metaValue}>
          <Badge color="var(--text-secondary)" icon="GitCommit">
            {t("preview.version", { version: skill.version })}
          </Badge>
        </dd>
        <dt style={s.metaLabel}>{t("previewDrawer.usedBy")}</dt>
        <dd style={s.metaValue} className="tnum">
          {t("card.agents", { count: skill.agent_count })}
        </dd>
        <dt style={s.metaLabel}>{t("previewDrawer.source")}</dt>
        <dd style={s.metaValue}>
          <span style={s.source}>
            <SourceIcon size={12} />
            {source}
          </span>
          <span style={s.typeChip(color.c, color.bg)}>{type}</span>
        </dd>
      </dl>

      <div style={s.bodyLabel}>{t("previewDrawer.body")}</div>
      <article style={s.body} data-testid="skill-preview-body">
        <Markdown>{skill.body}</Markdown>
      </article>
    </Drawer>
  );
}
