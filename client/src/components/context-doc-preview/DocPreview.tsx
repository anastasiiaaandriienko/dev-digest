/* DocPreview — read-only rendering of ONE discovered doc (redacted + capped by
   the API). Deliberately has no input, editor or save control (AC-CTX-52). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Markdown, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useContextFile } from "@/lib/hooks/context";
import { s } from "./styles";

export function DocPreview({
  repoId,
  path,
  fill = false,
}: {
  repoId: string;
  path: string | null;
  /** Page layout: no 520px cap on the body (the parent scrolls). Default keeps the cap. */
  fill?: boolean;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, error } = useContextFile(repoId, path);

  const reason = (() => {
    const details = error instanceof ApiError ? (error.details as { reason?: string } | undefined) : undefined;
    return error instanceof ApiError && error.status === 422 ? (details?.reason ?? error.message) : null;
  })();

  return (
    <section style={s.box} aria-label={t("preview.title")} data-testid="doc-preview">
      {!path && <div style={s.state}>{t("preview.empty")}</div>}
      {path && (
        <div style={s.head}>
          <span className="mono" style={s.path}>
            {path}
          </span>
          <Badge icon="Eye">{t("preview.readOnly")}</Badge>
        </div>
      )}
      {path && isLoading && (
        <div style={s.state} aria-busy="true">
          <Skeleton height={120} />
        </div>
      )}
      {path && isError && (
        <div role="alert" style={s.error}>
          {reason ? t("preview.unreadable", { reason }) : t("preview.loadError")}
        </div>
      )}
      {data && (
        <>
          <div style={fill ? s.bodyFill : s.body}>
            <Markdown>{data.content}</Markdown>
          </div>
          {data.truncated && <div style={s.note}>{t("preview.truncated")}</div>}
        </>
      )}
    </section>
  );
}
