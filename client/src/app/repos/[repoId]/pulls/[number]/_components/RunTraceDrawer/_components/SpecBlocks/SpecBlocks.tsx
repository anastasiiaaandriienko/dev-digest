/* SpecBlocks — the Project context section of a run's prompt: which attached
   docs were read, missing or skipped (path, source, reason, tokens, truncated),
   the section's token count, a summary with the limits, and the section text as
   persisted. The trace holds placeholders, never document text. Traces written
   before this feature have no spec_blocks: they show the section text only. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PromptAssembly } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { PromptBlock } from "../PromptBlock";
import { STATUS_COLOR } from "./constants";
import { s } from "./styles";

export function SpecBlocks({ assembly }: { assembly: PromptAssembly }) {
  const t = useTranslations("runs");
  const blocks = assembly.spec_blocks ?? null;
  const summary = assembly.spec_summary ?? null;
  const tokens = assembly.specs_tokens ?? null;
  const specs = assembly.specs ?? null;

  if (!blocks && !summary && tokens == null) {
    return specs != null ? <PromptBlock label={t("trace.prompt.specs")} text={specs} color={PROMPT_COLORS.specs} /> : null;
  }

  return (
    <section style={s.wrap} aria-label={t("trace.specBlocks.title")} data-testid="trace-spec-blocks">
      <div style={s.header}>
        <span style={s.title}>{t("trace.specBlocks.title")}</span>
        {summary && (
          <span style={s.meta} data-testid="trace-spec-summary">
            {t("trace.specBlocks.summary", {
              read: summary.read,
              attached: summary.attached,
              missing: summary.missing,
              skipped: summary.skipped,
              truncated: summary.truncated,
            })}
          </span>
        )}
        {tokens != null && (
          <span className="mono tnum" style={s.tokens} data-testid="trace-spec-tokens">
            {t("trace.specBlocks.tokens", { tokens })}
          </span>
        )}
      </div>
      {blocks && blocks.length > 0 && (
        <ol style={s.list} aria-label={t("trace.specBlocks.listLabel")}>
          {blocks.map((b, i) => (
            <li key={`${b.source}:${b.skill_id ?? ""}:${b.path}:${i}`} style={s.item} data-status={b.status}>
              <span className="mono" style={s.path}>
                {b.path}
              </span>
              <span style={s.source}>{t(`trace.specBlocks.source.${b.source}`)}</span>
              <span style={s.status(STATUS_COLOR[b.status])}>{t(`trace.specBlocks.status.${b.status}`)}</span>
              {b.reason && <span style={s.reason}>{b.reason}</span>}
              {b.truncated && <span style={s.truncated}>{t("trace.specBlocks.truncated")}</span>}
              {b.tokens != null && (
                <span className="mono tnum" style={s.blockTokens}>
                  {t("trace.specBlocks.blockTokens", { tokens: b.tokens })}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {summary && (
        <div style={s.limits}>
          {t("trace.specBlocks.limits", {
            docBytes: summary.limits.doc_bytes,
            docTokens: summary.limits.doc_tokens,
            promptTokens: summary.limits.prompt_tokens,
            attachments: summary.limits.attachments,
          })}
        </div>
      )}
      {specs != null && (
        <PromptBlock
          label={blocks ? t("trace.specBlocks.sent") : t("trace.prompt.specs")}
          text={specs}
          color={PROMPT_COLORS.specs}
        />
      )}
    </section>
  );
}
