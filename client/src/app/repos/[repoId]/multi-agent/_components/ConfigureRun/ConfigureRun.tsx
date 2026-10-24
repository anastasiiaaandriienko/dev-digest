/* ConfigureRun — /repos/:repoId/multi-agent?pr=<prId> (L07, AC-MAR-20, 25,
   26, 28..31). Step 1 picks one of the repo's stored PRs (preselected from
   ?pr=); step 2 picks 1..8 agents (enabled pre-checked, pick order = column
   order) with per-agent "≈ time · cost" from past local runs. The total is
   the slowest known agent and the sum of known costs (they run in parallel);
   unknown values are left out and flagged. Starting opens the PR's Results
   page; a failure keeps the selection (toast by the global handler). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import type { AgentEstimate } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { usePulls } from "@/lib/hooks/core";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useStartMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useRepoNotFound } from "@/lib/repo-context";
import { formatCost } from "@/lib/format";
import {
  MAX_AGENTS_PER_RUN,
  agentColor,
  configureRunHref,
  multiAgentResultsHref,
} from "@/lib/multi-agent";
import {
  initialSelection,
  isAtLimit,
  pruneSelection,
  toggleSelection,
} from "@/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/helpers";
import { AgentPickCard } from "./_components/AgentPickCard";
import {
  estimateTotals,
  formatEstimateDuration,
  pullFromQuery,
  selectAllAgents,
  selectablePulls,
  usableEstimate,
} from "./helpers";
import { SKELETON_CARDS } from "./constants";
import { s } from "./styles";

export function ConfigureRun({ repoId, prParam }: { repoId: string; prParam: string | null }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const repoNotFound = useRepoNotFound(repoId);
  const pullsQ = usePulls(repoId);
  const agentsQ = useAgents();
  const estimatesQ = useAgentEstimates();
  const start = useStartMultiAgentRun();

  const pulls = selectablePulls(pullsQ.data);
  const pr = pullFromQuery(pulls, prParam);
  const unknownPr = !!prParam && !!pullsQ.data && !pr;
  const agents = React.useMemo(() => agentsQ.data ?? [], [agentsQ.data]);
  const estimates = React.useMemo(
    () => new Map<string, AgentEstimate>((estimatesQ.data ?? []).map((e) => [e.agent_id, e])),
    [estimatesQ.data]
  );

  // Enabled agents are pre-checked once the list arrives; later edits are kept.
  const [selected, setSelected] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!agentsQ.data) return;
    setSelected((prev) => (prev === null ? initialSelection(agentsQ.data) : pruneSelection(prev, agentsQ.data)));
  }, [agentsQ.data]);
  const picked = selected ?? [];
  const atLimit = isAtLimit(picked);

  const crumb = [{ label: t("title") }, { label: t("configure.breadcrumb") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const estimateText = (agentId: string): string => {
    if (!estimatesQ.data) return "";
    const e = usableEstimate(estimates.get(agentId));
    if (!e) return t("configure.noEstimate");
    return t("configure.estimate", {
      duration: formatEstimateDuration(e.avg_duration_ms),
      cost: formatCost(e.avg_cost_usd),
    });
  };
  const totals = estimateTotals(picked, estimates);
  const hasTotal = totals.durationMs != null || totals.costUsd != null;

  const startRun = async () => {
    if (!pr || picked.length === 0 || start.isPending) return;
    try {
      await start.mutateAsync({ prId: pr.id, agentIds: picked });
      router.push(multiAgentResultsHref(repoId, pr.number));
    } catch {
      // Toasted by the global MutationCache handler; the selection is kept (AC-MAR-26).
    }
  };

  const loadFailed = pullsQ.isError || agentsQ.isError;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div>
          <h1 style={s.title}>{t("configure.title")}</h1>
          <p style={s.subtitle}>{t("configure.subtitle")}</p>
        </div>

        {loadFailed ? (
          <ErrorState
            title={t("configure.loadError")}
            onRetry={() => {
              void pullsQ.refetch();
              void agentsQ.refetch();
            }}
          />
        ) : (
          <>
            <section style={s.step} aria-label={t("configure.stepPullRequest")}>
              <div style={s.stepLabel}>
                <span style={s.stepNum}>1</span>
                {t("configure.stepPullRequest")}
              </div>
              {pullsQ.isLoading ? (
                <Skeleton height={40} />
              ) : (
                <div style={s.selectWrap}>
                  <SelectInput
                    aria-label={t("configure.stepPullRequest")}
                    mono={false}
                    value={pr?.id ?? ""}
                    onChange={(id) => router.replace(configureRunHref(repoId, id || null))}
                    options={[
                      { value: "", label: t("configure.selectPullRequest") },
                      ...pulls.map((p) => ({ value: p.id, label: `#${p.number} · ${p.title}` })),
                    ]}
                  />
                </div>
              )}
              {unknownPr && <span style={s.notice}>{t("configure.unknownPr")}</span>}
            </section>

            <section style={s.step} aria-label={t("configure.stepAgents")}>
              <div style={s.stepHead}>
                <div style={s.stepLabel}>
                  <span style={s.stepNum}>2</span>
                  {t("configure.stepAgents")}
                </div>
                {pr && agents.length > 0 && (
                  <button
                    type="button"
                    style={s.selectAll}
                    onClick={() => setSelected((prev) => selectAllAgents(prev ?? [], agents))}
                  >
                    {t("configure.selectAll")}
                  </button>
                )}
              </div>

              {!pr ? (
                <div style={s.placeholder}>
                  <span style={s.placeholderTitle}>{t("configure.pickPrFirst")}</span>
                  <span style={s.placeholderBody}>{t("configure.pickPrFirstBody")}</span>
                </div>
              ) : agentsQ.isLoading ? (
                <div style={s.cards}>
                  {Array.from({ length: SKELETON_CARDS }, (_, i) => (
                    <Skeleton key={i} height={64} />
                  ))}
                </div>
              ) : agents.length === 0 ? (
                <EmptyState
                  icon="Cpu"
                  title={t("configure.noAgentsTitle")}
                  body={t("configure.noAgentsBody")}
                  cta={t("configure.goToAgents")}
                  onCta={() => router.push("/agents")}
                />
              ) : (
                <div style={s.cards}>
                  {agents.map((a) => {
                    const checked = picked.includes(a.id);
                    return (
                      <AgentPickCard
                        key={a.id}
                        agentId={a.id}
                        name={a.name}
                        description={a.description}
                        estimate={estimateText(a.id)}
                        color={agentColor(a.id)}
                        checked={checked}
                        blocked={!checked && atLimit}
                        onToggle={() => setSelected((prev) => toggleSelection(prev ?? [], a.id))}
                      />
                    );
                  })}
                  {atLimit && <span style={s.note}>{t("picker.limit", { max: MAX_AGENTS_PER_RUN })}</span>}
                </div>
              )}
            </section>

            <div style={s.footer}>
              <Button
                kind="primary"
                icon="Users"
                disabled={!pr || picked.length === 0}
                loading={start.isPending}
                onClick={startRun}
              >
                {t("picker.run", { count: picked.length })}
              </Button>
              {pr && picked.length > 0 && (
                <span style={s.total} data-testid="estimate-total">
                  {hasTotal
                    ? t("configure.total", {
                        duration: formatEstimateDuration(totals.durationMs),
                        cost: formatCost(totals.costUsd),
                      })
                    : t("configure.noEstimate")}
                </span>
              )}
            </div>
            {pr && picked.length > 0 && totals.partial && <span style={s.note}>{t("configure.totalNote")}</span>}
          </>
        )}
      </div>
    </AppShell>
  );
}
