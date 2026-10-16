/* SkillsAssembly — the Skills section of a run's prompt (HW2 #19/#20): which
   skills were APPLIED (in prompt order, with version and tokens), the token
   count of the Skills section alone, and the section text as sent. Built only
   from the trace's run-time snapshot, so a skill that was disabled (for the
   agent or globally) never appears. Traces written before #19 have no
   skill_blocks / skills_tokens: they show the text only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PromptAssembly } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { PromptBlock } from "../PromptBlock";
import { s } from "./styles";

export function SkillsAssembly({ assembly }: { assembly: PromptAssembly }) {
  const t = useTranslations("runs");
  if (assembly.skills == null) return null; // no skill was applied to this run

  const blocks = assembly.skill_blocks ?? null;
  const tokens = assembly.skills_tokens ?? null;

  return (
    <section style={s.wrap} aria-label={t("trace.skills.title")} data-testid="trace-skills">
      {(blocks || tokens != null) && (
        <div style={s.header}>
          <span style={s.title}>{t("trace.skills.title")}</span>
          {blocks && <span style={s.meta}>{t("trace.skills.summary", { count: blocks.length })}</span>}
          {tokens != null && (
            <span className="mono tnum" style={s.tokens} data-testid="trace-skills-tokens">
              {t("trace.skills.tokens", { tokens })}
            </span>
          )}
        </div>
      )}
      {blocks && blocks.length > 0 && (
        <ol style={s.list} aria-label={t("trace.skills.listLabel")}>
          {[...blocks]
            .sort((a, b) => a.order - b.order)
            .map((b) => (
              <li key={`${b.skill_id}:${b.order}`} style={s.item} data-skill-id={b.skill_id}>
                <span className="mono tnum" style={s.position}>
                  {t("trace.skills.position", { position: b.order + 1 })}
                </span>
                <span className="mono" style={s.name}>
                  {b.name}
                </span>
                <span className="mono" style={s.version}>
                  {t("trace.skills.version", { version: b.version })}
                </span>
                <span className="mono tnum" style={s.blockTokens}>
                  {t("trace.skills.blockTokens", { tokens: b.tokens })}
                </span>
              </li>
            ))}
        </ol>
      )}
      <PromptBlock
        label={blocks ? t("trace.skills.sent") : t("trace.prompt.skills")}
        text={assembly.skills}
        color={PROMPT_COLORS.skills}
      />
    </section>
  );
}
