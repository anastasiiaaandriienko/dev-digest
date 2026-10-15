/* EvalsTab — eval cases of a skill (design: Skill Editor · Evals). This build
   has no eval API (no way to create, list or run cases), so the tab says so
   instead of showing sample cases or buttons that would do nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState } from "@devdigest/ui";
import { s } from "./styles";

export function EvalsTab() {
  const t = useTranslations("skills");
  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("detail.evals.title")}</h2>
        <Badge color="var(--text-muted)">{t("detail.evals.unavailableBadge")}</Badge>
      </div>
      <div style={s.panel} data-testid="evals-unavailable">
        <EmptyState icon="FlaskConical" title={t("detail.evals.unavailableTitle")} body={t("detail.evals.unavailableBody")} />
      </div>
    </div>
  );
}
