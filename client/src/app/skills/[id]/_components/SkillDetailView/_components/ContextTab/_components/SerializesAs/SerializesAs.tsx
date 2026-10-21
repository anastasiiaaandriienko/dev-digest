/* SerializesAs — how the skill's attached docs land in a review prompt: the
   `## Project context` section with the docs under the same group headings the
   server renders (Project specifications / docs / insights / other). Paths and
   approximate tokens only; doc text is never shown here. */
"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ContextAttachment, ContextListItem } from "@devdigest/shared";
import { PROMPT_SECTION } from "./constants";
import { serializedGroups } from "./helpers";
import { s } from "./styles";

export function SerializesAs({
  attachments,
  files,
  roots,
}: {
  attachments: readonly ContextAttachment[];
  files: readonly ContextListItem[];
  /** Effective roots of the repo (as listed by the server). */
  roots: readonly string[];
}) {
  const t = useTranslations("context");
  const format = useFormatter();
  const labelId = React.useId();
  const { groups, skipped } = serializedGroups(attachments, files, roots);

  return (
    <section style={s.wrap} aria-labelledby={labelId}>
      <div id={labelId} style={s.label}>
        {t("serializes.title")}
      </div>
      {groups.length === 0 ? (
        <p style={s.muted}>{t("serializes.empty")}</p>
      ) : (
        <div className="mono" style={s.box}>
          <div style={s.h2}>{PROMPT_SECTION}</div>
          {groups.map((g) => (
            <div key={g.title} style={s.group}>
              <div style={s.h3}>### {g.title}</div>
              <ul style={s.docs} aria-label={g.title}>
                {g.docs.map((d) => (
                  <li key={d.path} style={s.doc}>
                    <span style={s.path}>{d.path}</span>
                    {d.tokens !== null && (
                      <span style={s.tokens}>{t("serializes.tokens", { tokens: format.number(d.tokens) })}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {skipped > 0 && <p style={s.muted}>{t("serializes.skipped", { count: skipped })}</p>}
      <p style={s.muted}>{t("serializes.hint")}</p>
    </section>
  );
}
