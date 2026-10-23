/* AgentColumnCard — one agent's column in Columns mode (AC-MAR-33..35):
   name, duration, cost, score ring, finding cards (severity, title, file:line)
   and a footer with "View trace" + "N findings". A running column streams its
   live phase + log through the shared RunStatus (only when `live`, A-T3) and
   refetches the multi-run when its stream ends; a failed/cancelled column
   shows the status and the stored error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { RunStatus } from "@/app/repos/[repoId]/pulls/[number]/_components/RunStatus";
import { formatEstimateDuration } from "@/app/repos/[repoId]/multi-agent/_components/ConfigureRun/helpers";
import { formatCost } from "@/lib/format";
import { agentColor } from "@/lib/multi-agent";
import { lineRange } from "../../../ResultsView/helpers";
import { s } from "./styles";

export function AgentColumnCard({
  column,
  live,
  onViewTrace,
  onRunDone,
}: {
  column: AgentColumn;
  /** Stream this running column over SSE (at most MAX_LIVE_STREAMS are live). */
  live: boolean;
  onViewTrace: () => void;
  onRunDone: () => void;
}) {
  const t = useTranslations("multiAgent");
  const color = agentColor(column.agent_id || column.run_id);
  const failed = column.status === "failed" || column.status === "cancelled";

  return (
    <section style={s.column(color)} aria-label={column.agent_name} data-testid={`column-${column.run_id}`}>
      <div style={s.head}>
        <div style={s.headMain}>
          <div style={s.name}>{column.agent_name}</div>
          <div style={s.meta}>
            {formatEstimateDuration(column.duration_ms)} · {formatCost(column.cost_usd)}
          </div>
        </div>
        {column.score != null && <CircularScore score={column.score} size={36} />}
      </div>

      <div style={s.body}>
        {column.status === "running" ? (
          live ? (
            <RunStatus runIds={[column.run_id]} onDone={onRunDone} />
          ) : (
            <span style={s.running}>{t("status.running")}</span>
          )
        ) : failed ? (
          <div style={s.failed} role="alert">
            <span style={s.failedLabel}>{t(`status.${column.status}`)}</span>
            <span style={s.failedError}>{column.error || t("status.noError")}</span>
          </div>
        ) : column.findings.length === 0 ? (
          <span style={s.empty}>{t("results.noFindings")}</span>
        ) : (
          column.findings.map((f) => (
            <div key={f.id} style={s.finding}>
              <SeverityBadge severity={f.severity as Severity} compact />
              <div style={s.findingMain}>
                <span style={s.findingTitle}>{f.title}</span>
                <span className="mono" style={s.findingLoc}>
                  {f.file}:{lineRange(f)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={s.foot}>
        <Button kind="ghost" size="sm" icon="Eye" onClick={onViewTrace}>
          {t("results.viewTrace")}
        </Button>
        <span style={s.count}>{t("results.findings", { count: column.findings.length })}</span>
      </div>
    </section>
  );
}
