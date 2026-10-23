/* EvalRunsTable — the agent's eval run history (design screen_skills.jsx
   `ScreenEval` runs table): pick two finished runs to compare, click a row (or
   "Details") for the run detail. N/A for undefined metrics and unknown cost. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox } from "@devdigest/ui";
import type { AgentEvalRun } from "@devdigest/shared";
import { fmtCost, fmtPct } from "@/lib/evals";
import { s } from "./styles";

const STATUS = {
  running: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  done: { color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
} as const;

export function EvalRunsTable({
  runs,
  selected,
  onToggle,
  onOpen,
}: {
  runs: readonly AgentEvalRun[];
  selected: readonly string[];
  onToggle: (runId: string) => void;
  onOpen: (runId: string) => void;
}) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  return (
    <div style={s.table} role="table" aria-label={t("dashboard.recentRuns")}>
      <div style={s.head} role="row">
        {["", t("dashboard.table.ranAt"), t("dashboard.table.version"), t("dashboard.table.recall"), t("dashboard.table.precision"),
          t("dashboard.table.citation"), t("dashboard.table.cases"), t("dashboard.table.cost"), t("dashboard.table.status")].map((h, i) => (
          <div key={i} role="columnheader">
            {h}
          </div>
        ))}
      </div>
      {runs.map((r) => {
        const on = selected.includes(r.id);
        const selectable = r.status === "done";
        return (
          <div
            key={r.id}
            role="row"
            data-testid="dashboard-run-row"
            data-status={r.status}
            data-selected={on || undefined}
            style={s.row(on)}
            onClick={() => onOpen(r.id)}
          >
            <div role="cell" onClick={(e) => e.stopPropagation()} title={selectable ? undefined : t("dashboard.onlyDoneSelectable")}>
              {selectable ? (
                <Checkbox
                  checked={on}
                  onChange={() => onToggle(r.id)}
                  label={<span style={s.srOnly}>{t("dashboard.selectRun", { version: r.agent_version })}</span>}
                />
              ) : null}
            </div>
            <div role="cell" className="mono" style={s.muted}>
              {new Date(r.started_at).toLocaleString()}
            </div>
            <div role="cell" className="mono" style={s.version}>
              {t("evalsTab.history.version", { version: r.agent_version })}
            </div>
            <div role="cell" className="tnum">{fmtPct(r.recall, na)}</div>
            <div role="cell" className="tnum">{fmtPct(r.precision, na)}</div>
            <div role="cell" className="tnum">{fmtPct(r.citation_accuracy, na)}</div>
            <div role="cell" className="tnum">{r.counts ? `${r.counts.cases_passed}/${r.counts.cases_total}` : na}</div>
            <div role="cell" className="mono tnum" style={s.muted}>
              {fmtCost(r.cost_usd, na)}
            </div>
            <div role="cell">
              <Badge color={STATUS[r.status].color} bg={STATUS[r.status].bg}>
                {t(`evalsTab.history.status.${r.status}`)}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
