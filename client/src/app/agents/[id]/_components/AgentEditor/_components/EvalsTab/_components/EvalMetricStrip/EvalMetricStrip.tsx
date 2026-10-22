/* EvalMetricStrip — Recall / Precision / Citation accuracy / Cases passed of the
   latest finished eval run, with the ▲/▼ pt delta vs the previous finished run
   (design `EvalMetricStrip`). Undefined metrics read "N/A" and have no delta. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { AgentEvalRun } from "@devdigest/shared";
import { deltaPt, fmtPct } from "@/lib/evals";
import { s } from "./styles";

export function EvalMetricStrip({ latest, previous }: { latest: AgentEvalRun; previous: AgentEvalRun | null }) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  const metrics = [
    { key: "recall", label: t("evalsTab.metric.recall"), cur: latest.recall, prev: previous?.recall, color: "var(--accent)" },
    { key: "precision", label: t("evalsTab.metric.precision"), cur: latest.precision, prev: previous?.precision, color: "var(--ok)" },
    { key: "citation", label: t("evalsTab.metric.citation"), cur: latest.citation_accuracy, prev: previous?.citation_accuracy, color: "var(--warn)" },
  ] as const;
  const counts = latest.counts;
  return (
    <div>
      <div style={s.strip}>
        {metrics.map((m) => {
          const d = deltaPt(m.cur, m.prev);
          return (
            <div key={m.key} style={s.tile} data-testid={`eval-metric-${m.key}`}>
              <div style={s.label}>{m.label}</div>
              <div style={s.valueRow}>
                <span className="tnum" style={s.value(m.cur == null ? "var(--text-muted)" : m.color)}>
                  {fmtPct(m.cur, na)}
                </span>
                {d != null && d !== 0 && (
                  <span className="tnum" style={s.delta(d)}>
                    {(d > 0 ? "▲ " : "▼ ") + Math.abs(d) + "pt"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div style={s.tile} data-testid="eval-metric-cases">
          <div style={s.label}>{t("evalsTab.metric.casesPassed")}</div>
          <div style={s.valueRow}>
            <span className="tnum" style={s.value("var(--text-secondary)")}>
              {counts ? `${counts.cases_passed}/${counts.cases_total}` : na}
            </span>
          </div>
        </div>
      </div>
      {counts && (
        <div style={s.fp} data-testid="eval-fp-breakdown">
          {t("evalsTab.fpBreakdown", {
            unlabeled: counts.fp_by_reason.unlabeled,
            negative: counts.fp_by_reason.negative_hit,
            duplicate: counts.fp_by_reason.duplicate,
            tooWide: counts.fp_by_reason.too_wide,
          })}
        </div>
      )}
    </div>
  );
}
