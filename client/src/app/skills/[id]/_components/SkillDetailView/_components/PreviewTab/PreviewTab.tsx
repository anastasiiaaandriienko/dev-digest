/* PreviewTab — the skill body rendered as Markdown (HW2 #26), i.e. formatted
   the way it reads, not raw text. Shows the saved body, not unsaved edits. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("detail.previewTab.title")}</h2>
      <p style={s.subtitle}>{t("detail.previewTab.subtitle")}</p>
      <article style={s.card} data-testid="skill-rendered-body">
        <Markdown>{skill.body}</Markdown>
      </article>
    </div>
  );
}
