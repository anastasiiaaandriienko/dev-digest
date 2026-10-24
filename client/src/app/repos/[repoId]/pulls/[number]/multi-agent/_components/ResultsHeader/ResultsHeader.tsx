/* ResultsHeader — Results page header (AC-MAR-32, 47, 49): "Configure run"
   back button, title, "N selected agents · parallel", the PR line, the
   summary "N agents · parallel · wall-clock total · cost", a Columns/Tabs
   toggle (?view) and "Start new review". Never "fan-out via worktrees". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { MultiAgentRun } from "@devdigest/shared";
import { formatEstimateDuration } from "@/app/repos/[repoId]/multi-agent/_components/ConfigureRun/helpers";
import { formatCost } from "@/lib/format";
import type { ResultsViewMode } from "../ResultsView/helpers";
import { s } from "./styles";

export function ResultsHeader({
  run,
  prNumber,
  prTitle,
  view,
  onViewChange,
  onConfigure,
}: {
  run: MultiAgentRun;
  prNumber: number;
  prTitle: string;
  view: ResultsViewMode;
  onViewChange: (view: ResultsViewMode) => void;
  /** Opens Configure run for this PR ("Configure run" and "Start new review"). */
  onConfigure: () => void;
}) {
  const t = useTranslations("multiAgent");
  return (
    <header style={s.root}>
      <div style={s.topRow}>
        <Button kind="secondary" size="sm" icon="ChevronLeft" onClick={onConfigure}>
          {t("results.configureRun")}
        </Button>
        <h1 style={s.title}>{t("title")}</h1>
        <span style={s.selected}>{t("results.selectedAgents", { count: run.agent_count })}</span>
        <span style={s.spacer} />
        <span style={s.toggle} role="group" aria-label="View">
          {(["columns", "tabs"] as const).map((mode) => (
            <Button
              key={mode}
              kind="ghost"
              size="sm"
              active={view === mode}
              aria-pressed={view === mode}
              onClick={() => onViewChange(mode)}
            >
              {t(mode === "columns" ? "results.viewColumns" : "results.viewTabs")}
            </Button>
          ))}
        </span>
        <Button kind="primary" size="sm" icon="Plus" onClick={onConfigure}>
          {t("results.startNewReview")}
        </Button>
      </div>
      <div style={s.infoRow}>
        <span className="mono" style={s.pr}>
          #{prNumber} {prTitle}
        </span>
        <span style={s.summary} data-testid="results-summary">
          {t("results.summary", {
            count: run.agent_count,
            duration: formatEstimateDuration(run.wall_clock_ms),
            cost: formatCost(run.total_cost_usd, { partial: run.cost_partial }),
          })}
        </span>
        {run.cost_partial && <span style={s.partial}>{t("results.costPartial")}</span>}
      </div>
    </header>
  );
}
