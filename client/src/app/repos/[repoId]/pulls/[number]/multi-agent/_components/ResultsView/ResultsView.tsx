/* ResultsView — /repos/:repoId/pulls/:number/multi-agent (L07 Results,
   AC-MAR-32..41, 45..47, 49, 58). Shows the PR's latest multi-run from
   GET /pulls/:id/multi-agent as Columns or Tabs (?view, default columns),
   opens RunTraceDrawer via ?trace=, and streams at most MAX_LIVE_STREAMS
   running runs over SSE (the drawer's own stream counts against that). A
   reload just re-reads the latest multi-run and re-subscribes to its
   non-terminal runs (AC-MAR-45). Below either mode: "Where agents disagree"
   (T11, AC-MAR-42..44). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import RunTraceDrawer from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { usePulls } from "@/lib/hooks/core";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { MAX_LIVE_STREAMS, configureRunHref, multiAgentResultsHref } from "@/lib/multi-agent";
import { ResultsHeader } from "../ResultsHeader";
import { ColumnsView } from "../ColumnsView";
import { TabsView } from "../TabsView";
import { DisagreeBlock } from "../DisagreeBlock";
import { parseView, toFindingRecord, type ResultsViewMode } from "./helpers";
import { s } from "./styles";

export function ResultsView({ repoId, prNumber }: { repoId: string; prNumber: number }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const pullsQ = usePulls(repoId);
  const pull = pullsQ.data?.find((p) => p.number === prNumber) ?? null;
  const prId = pull?.id ?? null;
  const multi = useMultiAgentRun(prId);

  const view = parseView(search.get("view"));
  const traceRunId = search.get("trace");
  const setParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    const base = multiAgentResultsHref(repoId, prNumber);
    router.replace(sp.toString() ? `${base}?${sp.toString()}` : base);
  };
  const configure = () => router.push(configureRunHref(repoId, prId));

  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: `#${prNumber}`, mono: true, href: `/repos/${repoId}/pulls/${prNumber}` },
    { label: t("title") },
  ];

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (pullsQ.isLoading || (prId != null && multi.isLoading)) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loading} data-testid="results-loading">
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={240} />
        </div>
      </AppShell>
    );
  }

  if (pullsQ.isError || multi.isError || !pull || !prId) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          title={t("results.loadError")}
          onRetry={() => {
            void pullsQ.refetch();
            if (prId) void multi.refetch();
          }}
        />
      </AppShell>
    );
  }

  const run = multi.data?.multi_run ?? null;
  if (!run) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState
            icon="Users"
            title={t("results.emptyTitle")}
            body={t("results.emptyBody")}
            cta={t("results.startNewReview")}
            onCta={configure}
          />
        </div>
      </AppShell>
    );
  }

  const traceColumn = traceRunId ? run.columns.find((c) => c.run_id === traceRunId) ?? null : null;
  const traceStreams = traceColumn?.status === "running" ? 1 : 0;
  const refetch = () => void multi.refetch();

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <ResultsHeader
          run={run}
          prNumber={prNumber}
          prTitle={pull.title}
          view={view}
          onViewChange={(mode: ResultsViewMode) => setParam("view", mode === "columns" ? null : mode)}
          onConfigure={configure}
        />
        {view === "columns" ? (
          <ColumnsView
            columns={run.columns}
            maxLive={MAX_LIVE_STREAMS - traceStreams}
            onViewTrace={(runId) => setParam("trace", runId)}
            onRunDone={refetch}
          />
        ) : (
          <TabsView
            columns={run.columns}
            prId={prId}
            repoFullName={activeRepo?.full_name ?? null}
            headSha={pull.head_sha}
            onViewTrace={(runId) => setParam("trace", runId)}
          />
        )}
        <DisagreeBlock run={run} columns={run.columns} />
      </div>
      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          agentName={traceColumn.agent_name}
          prNumber={prNumber}
          findings={traceColumn.findings.map(toFindingRecord)}
          running={traceColumn.status === "running"}
          runStatus={traceColumn.status}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
