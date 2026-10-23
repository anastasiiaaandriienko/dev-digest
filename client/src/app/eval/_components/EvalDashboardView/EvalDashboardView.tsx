/* EvalDashboardView — /eval (L06, spec §12.3; design screen_skills.jsx
   `ScreenEval`). One agent at a time (`?agent=`, default: the first agent):
   metric cards of the latest finished run with trend sparklines, the metric
   trend chart, the run history (select two finished runs → compare) and the run
   detail (`?run=`). "Run evals" starts a PAID run only after the shared
   confirmation. Read-only otherwise; all numbers come from the eval API. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, LineChart, MetricCard, SectionLabel, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RunEvalsConfirm } from "@/components/run-evals-confirm";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEvalCases, useAgentEvalRuns, useStartEvalRun } from "@/lib/hooks/evals";
import {
  deltaPt,
  distinctInputs,
  isRunning,
  latestDoneRuns,
  metricTrend,
  orderForCompare,
  pct,
  toggleRunSelection,
  trendRuns,
} from "@/lib/evals";
import { notify } from "@/lib/toast";
import { EvalRunsTable } from "../EvalRunsTable";
import { RunCompareModal } from "../RunCompareModal";
import { RunDetailDrawer } from "../RunDetailDrawer";
import { EVAL_DASHBOARD_RUNS_LIMIT } from "./constants";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const search = useSearchParams();
  const router = useRouter();
  const agentsQ = useAgents();
  const agents = agentsQ.data ?? [];
  const agentParam = search.get("agent");
  const runParam = search.get("run");
  const agent = agents.find((a) => a.id === agentParam) ?? null;

  // No ?agent= → the first agent (replace, so Back does not bounce).
  React.useEffect(() => {
    if (!agentParam && agents.length > 0) router.replace(`/eval?agent=${agents[0]!.id}`);
  }, [agentParam, agents, router]);

  const setParams = (next: { agent?: string; run?: string | null }) => {
    const sp = new URLSearchParams(search.toString());
    if (next.agent) {
      sp.set("agent", next.agent);
      sp.delete("run");
    }
    if (next.run === null) sp.delete("run");
    else if (next.run) sp.set("run", next.run);
    router.replace(`/eval?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard") },
    ...(agent ? [{ label: agent.name }] : []),
  ];

  let content: React.ReactNode;
  if (agentsQ.isLoading) content = <Skeleton height={320} />;
  else if (agentsQ.isError)
    content = <ErrorState title={t("dashboard.loadError")} body={(agentsQ.error as Error)?.message} onRetry={() => void agentsQ.refetch()} />;
  else if (agents.length === 0) content = <EmptyState icon="Cpu" title={t("dashboard.noAgentsTitle")} body={t("dashboard.noAgents")} />;
  else if (agentParam && !agent) content = <ErrorState title={t("dashboard.loadError")} body={t("dashboard.agentNotFound")} />;
  else if (agent)
    content = (
      <AgentEvalPanel
        key={agent.id}
        agent={agent}
        agents={agents}
        runId={runParam}
        onAgent={(id) => setParams({ agent: id })}
        onRun={(id) => setParams({ run: id })}
      />
    );
  else content = <Skeleton height={320} />;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>{content}</div>
    </AppShell>
  );
}

function AgentEvalPanel({
  agent,
  agents,
  runId,
  onAgent,
  onRun,
}: {
  agent: Agent;
  agents: readonly Agent[];
  runId: string | null;
  onAgent: (id: string) => void;
  onRun: (id: string | null) => void;
}) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  const runsQ = useAgentEvalRuns(agent.id, EVAL_DASHBOARD_RUNS_LIMIT);
  const casesQ = useAgentEvalCases(agent.id);
  const start = useStartEvalRun(agent.id);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const runs = runsQ.data ?? [];
  const cases = casesQ.data ?? [];
  const running = isRunning(runs);
  const { latest, previous } = latestDoneRuns(runs);
  const trend = trendRuns(runs);
  const selectedRuns = selected.map((id) => runs.find((r) => r.id === id)).filter((r) => r != null);
  const pair = selectedRuns.length === 2 ? orderForCompare(selectedRuns[0]!, selectedRuns[1]!) : null;
  const precisionDrop = latest && previous ? deltaPt(latest.precision, previous.precision) : null;

  const metricCards = [
    { key: "recall", label: t("dashboard.metrics.recall"), color: "var(--accent)" },
    { key: "precision", label: t("dashboard.metrics.precision"), color: "var(--ok)" },
    { key: "citation_accuracy", label: t("dashboard.metrics.citationAccuracy"), color: "var(--warn)" },
  ] as const;

  return (
    <>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>{t("dashboard.defaultTitle")}</h1>
          <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
        </div>
        <div style={s.headerActions}>
          <div style={s.agentSelect}>
            <SelectInput
              aria-label={t("dashboard.agentLabel")}
              value={agent.id}
              onChange={onAgent}
              mono={false}
              options={agents.map((a) => ({ value: a.id, label: a.name }))}
            />
          </div>
          <Link href={`/agents/${agent.id}?tab=evals`} style={s.agentLink}>
            {t("dashboard.openAgent")}
          </Link>
          <Button
            kind="primary"
            size="sm"
            icon="Play"
            disabled={running || cases.length === 0 || casesQ.isLoading}
            title={running ? t("evalsTab.runDisabledRunning") : cases.length === 0 ? t("evalsTab.runDisabledNoCases") : undefined}
            onClick={() => setConfirming(true)}
          >
            {t("dashboard.runEvals")}
          </Button>
        </div>
      </div>

      {running && (
        <div style={s.banner("info")} role="status" data-testid="dashboard-running">
          <Icon.RefreshCw size={15} />
          {t("evalsTab.runningBanner")}
        </div>
      )}
      {precisionDrop != null && precisionDrop < 0 && latest && (
        <div style={s.banner("warn")} role="alert" data-testid="dashboard-precision-dip">
          <Icon.AlertTriangle size={15} style={{ color: "var(--warn)" }} />
          {t("dashboard.precisionDipped", { pt: Math.abs(precisionDrop), version: latest.agent_version })}
        </div>
      )}

      {runsQ.isLoading ? (
        <Skeleton height={140} />
      ) : runsQ.isError ? (
        <ErrorState title={t("evalsTab.loadRunsError")} body={(runsQ.error as Error)?.message} onRetry={() => void runsQ.refetch()} />
      ) : runs.length === 0 ? (
        <EmptyState icon="Gauge" title={t("dashboard.defaultTitle")} body={t("dashboard.noRuns")} />
      ) : (
        <>
          {latest ? (
            <div style={s.cards} data-testid="dashboard-metric-cards">
              {metricCards.map((m) => {
                const v = pct(latest[m.key]);
                const prev = previous ? previous[m.key] : null;
                const cur = latest[m.key];
                return (
                  <MetricCard
                    key={m.key}
                    label={m.label}
                    value={v == null ? na : v}
                    suffix={v == null ? undefined : "%"}
                    color={m.color}
                    delta={cur != null && prev != null ? cur - prev : undefined}
                    trend={metricTrend(runs, m.key)}
                  />
                );
              })}
            </div>
          ) : (
            <div style={s.muted} data-testid="dashboard-no-finished">
              {t("dashboard.noFinishedRun")}
            </div>
          )}

          <div style={s.card}>
            <div style={s.cardHead}>
              <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
              <div style={s.legend}>
                {(
                  [
                    ["recall", "var(--accent)"],
                    ["precision", "var(--ok)"],
                    ["citation", "var(--warn)"],
                  ] as const
                ).map(([k, c]) => (
                  <span key={k} style={s.legendItem}>
                    <span style={s.legendSwatch(c)} />
                    {t(`dashboard.legend.${k}`)}
                  </span>
                ))}
              </div>
            </div>
            {trend.runs.length > 0 ? (
              <LineChart
                yMin={0}
                yMax={1}
                w={900}
                h={200}
                series={[
                  { name: "recall", color: "var(--accent)", data: trend.runs.map((r) => r.recall!) },
                  { name: "precision", color: "var(--ok)", data: trend.runs.map((r) => r.precision!) },
                  { name: "citation", color: "var(--warn)", data: trend.runs.map((r) => r.citation_accuracy!) },
                ]}
              />
            ) : (
              <div style={s.muted}>{t("dashboard.trendEmpty")}</div>
            )}
            {trend.skipped > 0 && (
              <div style={s.muted} data-testid="dashboard-trend-skipped">
                {t("dashboard.trendSkipped", { count: trend.skipped })}
              </div>
            )}
          </div>

          <div style={s.runsHead}>
            <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
            <span style={s.muted}>
              {selected.length === 0 ? t("dashboard.selectHint") : t("dashboard.selectedCount", { count: selected.length })}
            </span>
            <div style={s.runsActions}>
              <Button kind={pair ? "primary" : "ghost"} size="sm" icon="GitBranch" disabled={!pair} onClick={() => setComparing(true)}>
                {t("dashboard.compare")}
              </Button>
            </div>
          </div>
          <EvalRunsTable runs={runs} selected={selected} onToggle={(id) => setSelected((cur) => toggleRunSelection(cur, id))} onOpen={(id) => onRun(id)} />
        </>
      )}

      {runId && <RunDetailDrawer runId={runId} onClose={() => onRun(null)} />}
      {comparing && pair && (
        <RunCompareModal
          baseId={pair[0].id}
          headId={pair[1].id}
          baseVersion={pair[0].agent_version}
          headVersion={pair[1].agent_version}
          onClose={() => setComparing(false)}
        />
      )}
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
    </>
  );
}
