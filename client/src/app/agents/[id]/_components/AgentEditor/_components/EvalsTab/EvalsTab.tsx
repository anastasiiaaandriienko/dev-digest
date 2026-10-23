/* EvalsTab — AgentEditor → Evals (L06, spec §12.2; design screen_agents.jsx
   `EvalsTab`): metrics of the latest finished run, the agent's eval cases with
   their latest result, "Run evals" behind a paid-call confirmation, and the
   recent runs (running / done / failed) linking to the Eval Dashboard.
   Opening the tab only READS; a run starts only from the confirmation. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentEvalCases, useAgentEvalRuns, useStartEvalRun } from "@/lib/hooks/evals";
import { notify } from "@/lib/toast";
import { EvalCaseRow } from "./_components/EvalCaseRow";
import { EvalMetricStrip } from "./_components/EvalMetricStrip";
import { EvalRunHistory } from "./_components/EvalRunHistory";
import { RunEvalsConfirm } from "@/components/run-evals-confirm";
import { EVAL_HISTORY_LIMIT, EVAL_HISTORY_SHOWN } from "./constants";
import { distinctInputs, isRunning, latestDoneRuns, passingCounts } from "@/lib/evals";
import { s } from "./styles";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const casesQ = useAgentEvalCases(agent.id);
  const runsQ = useAgentEvalRuns(agent.id, EVAL_HISTORY_LIMIT);
  const start = useStartEvalRun(agent.id);
  const [confirming, setConfirming] = React.useState(false);

  const cases = casesQ.data ?? [];
  const runs = runsQ.data ?? [];
  const running = isRunning(runs);
  const { latest, previous } = latestDoneRuns(runs);
  const newest = runs[0];
  const { passed, ran } = passingCounts(cases);

  // When a run finishes, the cases' "last result" changed too.
  const wasRunning = React.useRef(running);
  const refetchCases = casesQ.refetch;
  React.useEffect(() => {
    if (wasRunning.current && !running) void refetchCases();
    wasRunning.current = running;
  }, [running, refetchCases]);

  const dashboardHref = `/eval?agent=${agent.id}`;
  const runDisabledReason = running
    ? t("evalsTab.runDisabledRunning")
    : cases.length === 0
      ? t("evalsTab.runDisabledNoCases")
      : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.sectionHead}>
        <SectionLabel icon="Gauge">{t("evalsTab.metricsTitle")}</SectionLabel>
        <div style={s.sectionRight}>
          <Link href={dashboardHref} style={s.dashboardLink}>
            {t("evalsTab.viewDashboard")}
          </Link>
        </div>
      </div>

      {runsQ.isLoading ? (
        <Skeleton height={74} />
      ) : runsQ.isError ? (
        <ErrorState title={t("evalsTab.loadRunsError")} body={(runsQ.error as Error)?.message} onRetry={() => void runsQ.refetch()} />
      ) : latest ? (
        <>
          <div style={s.metricsFrom}>
            {t("evalsTab.metricsFrom", { version: latest.agent_version, date: new Date(latest.started_at).toLocaleString() })}
          </div>
          <EvalMetricStrip latest={latest} previous={previous} />
        </>
      ) : (
        <div style={s.metricsFrom} data-testid="eval-no-finished-run">
          {t("evalsTab.noFinishedRun")}
        </div>
      )}

      {running && (
        <div style={s.banner("info")} role="status" data-testid="eval-running-banner">
          <Icon.RefreshCw size={15} />
          {t("evalsTab.runningBanner")}
        </div>
      )}
      {!running && newest?.status === "failed" && (
        <div style={s.banner("warn")} role="alert" data-testid="eval-failed-banner">
          <Icon.AlertTriangle size={15} style={{ color: "var(--warn)" }} />
          {t("evalsTab.lastFailed", { error: newest.error ?? "" })}
        </div>
      )}

      <div style={s.scoringNote}>
        <Icon.Code size={12} />
        {t("evalsTab.scoringNote")}
      </div>

      <div style={s.casesHead}>
        <h2 style={s.casesTitle}>{t("evalsTab.casesHeading")}</h2>
        {cases.length > 0 && (
          <>
            <Badge
              color={passed === ran ? "var(--ok)" : "var(--warn)"}
              bg={passed === ran ? "var(--ok-bg)" : "var(--warn-bg)"}
            >
              {t("evalsTab.passingBadge", { passed, total: ran })}
            </Badge>
            <Badge color="var(--text-muted)">{t("evalsTab.casesBadge", { count: cases.length })}</Badge>
          </>
        )}
        <div style={s.casesActions}>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={!!runDisabledReason || casesQ.isLoading}
            title={runDisabledReason}
            onClick={() => setConfirming(true)}
          >
            {t("evalsTab.runEvals")}
          </Button>
        </div>
      </div>

      {casesQ.isLoading ? (
        <>
          <Skeleton height={44} style={{ marginBottom: 6 }} />
          <Skeleton height={44} />
        </>
      ) : casesQ.isError ? (
        <ErrorState title={t("evalsTab.loadCasesError")} body={(casesQ.error as Error)?.message} onRetry={() => void casesQ.refetch()} />
      ) : cases.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCasesTitle")} body={t("evalsTab.emptyCases")} />
      ) : (
        <div data-testid="eval-case-list">
          {cases.map((c) => (
            <EvalCaseRow key={c.id} c={c} />
          ))}
        </div>
      )}

      <div style={s.historyWrap}>
        <SectionLabel icon="History">{t("evalsTab.history.title")}</SectionLabel>
        {!runsQ.isLoading && !runsQ.isError && <EvalRunHistory agentId={agent.id} runs={runs.slice(0, EVAL_HISTORY_SHOWN)} />}
      </div>

      {confirming && (
        <RunEvalsConfirm
          agentName={agent.name}
          version={agent.version}
          cases={cases.length}
          inputs={distinctInputs(cases)}
          onConfirm={async () => {
            await start.mutateAsync();
            notify.success(t("evalsTab.started"));
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
