/* EvalRunHistory — the agent's latest eval runs: status (running / done /
   failed), when, version, R / P / C (N/A when undefined), cost (N/A when
   unknown) and a link to the run on the Eval Dashboard (spec §12.3). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { AgentEvalRun } from "@devdigest/shared";
import { fmtCost, fmtPct } from "@/lib/evals";
import { s } from "./styles";

const STATUS_STYLE = {
  running: { color: "var(--accent-text)", bg: "var(--accent-bg)", icon: "RefreshCw" },
  done: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "Check" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertTriangle" },
} as const;

export function EvalRunHistory({ agentId, runs }: { agentId: string; runs: readonly AgentEvalRun[] }) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  if (runs.length === 0) return <div style={s.empty}>{t("evalsTab.history.empty")}</div>;
  return (
    <div style={s.table} role="table" aria-label={t("evalsTab.history.title")}>
      {runs.map((r) => {
        const st = STATUS_STYLE[r.status];
        return (
          <div key={r.id} style={s.row} role="row" data-testid="eval-run-row" data-status={r.status}>
            <span role="cell">
              <Badge color={st.color} bg={st.bg} icon={st.icon}>
                {t(`evalsTab.history.status.${r.status}`)}
              </Badge>
            </span>
            <span role="cell" className="mono" style={s.muted}>
              {new Date(r.started_at).toLocaleString()}
            </span>
            <span role="cell" className="mono" style={s.version}>
              {t("evalsTab.history.version", { version: r.agent_version })}
            </span>
            <span role="cell" className="tnum" style={s.metrics}>
              {t("evalsTab.history.recall")} {fmtPct(r.recall, na)} · {t("evalsTab.history.precision")} {fmtPct(r.precision, na)} ·{" "}
              {t("evalsTab.history.citation")} {fmtPct(r.citation_accuracy, na)}
            </span>
            <span role="cell" className="mono tnum" style={s.muted} title={t("evalsTab.history.cost")}>
              {fmtCost(r.cost_usd, na)}
            </span>
            <span role="cell" style={s.linkCell}>
              <Link href={`/eval?agent=${agentId}&run=${r.id}`} style={s.link}>
                {t("evalsTab.history.details")}
              </Link>
            </span>
          </div>
        );
      })}
    </div>
  );
}
