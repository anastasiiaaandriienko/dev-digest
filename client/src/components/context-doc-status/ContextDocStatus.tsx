/* ContextDocStatus — badge for an attached context doc: ok / missing /
   outside_roots (the last two are skipped at review time). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { ContextAttachmentStatus } from "@devdigest/shared";
import { STATUS_STYLE } from "./constants";

export function ContextDocStatus({ status }: { status: ContextAttachmentStatus }) {
  const t = useTranslations("context");
  const style = STATUS_STYLE[status];
  return (
    <span title={t(`attach.statusHint.${status}`)} data-status={status}>
      <Badge color={style.color} bg={style.bg} icon={style.icon}>
        {t(`attach.status.${status}`)}
      </Badge>
    </span>
  );
}
