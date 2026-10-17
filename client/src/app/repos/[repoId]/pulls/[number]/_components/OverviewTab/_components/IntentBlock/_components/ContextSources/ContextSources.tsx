"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { IntentContextSource } from "@devdigest/shared";
import { STATUS_COLORS } from "./constants";
import { contextGaps, listedSources } from "./helpers";
import { s } from "./styles";

interface ContextSourcesProps {
  /** As recorded with the stored intent; null = not recorded (older intent). */
  sources: IntentContextSource[] | null | undefined;
}

/**
 * Which context the intent was generated from, and what was missing. Refs and
 * titles come from the PR / GitHub (untrusted): rendered as plain text, URLs
 * are never turned into links.
 */
export function ContextSources({ sources }: ContextSourcesProps) {
  const t = useTranslations("intent.context");
  if (!sources) {
    return (
      <div style={s.root}>
        <div style={s.groupTitle}>{t("title")}</div>
        <p style={s.muted}>{t("notRecorded")}</p>
      </div>
    );
  }
  const listed = listedSources(sources);
  const gaps = contextGaps(sources);
  return (
    <div style={s.root} aria-label={t("title")}>
      <div style={s.groupTitle}>{t("title")}</div>
      {listed.length === 0 ? (
        <p style={s.muted}>{t("onlyPr")}</p>
      ) : (
        <ul style={s.list}>
          {listed.map((src, i) => {
            const c = STATUS_COLORS[src.status];
            return (
              <li key={`${src.kind}:${src.ref}:${i}`} style={s.item}>
                <span style={s.kind}>{t(`kind.${src.kind}`)}</span>
                <span style={s.ref}>{src.ref}</span>
                {src.title && <span>{src.title}</span>}
                <Badge color={c.color} bg={c.bg}>
                  {t(`status.${src.status}`)}
                </Badge>
                {src.note && <span style={s.note}>{t(`note.${src.note}`)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {gaps.length > 0 && (
        <ul style={s.gaps} aria-label={t("gapsLabel")}>
          {gaps.map((g) => (
            <li key={g.key}>{t(`gaps.${g.key}`, { count: g.count ?? 0 })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
