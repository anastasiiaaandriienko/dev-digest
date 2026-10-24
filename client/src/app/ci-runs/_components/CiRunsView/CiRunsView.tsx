/* CiRunsView — /ci-runs (L07, specs/export-to-ci.md §6.3 "CI Runs page"; AC-CI-49,
   51..54, 57, 76, 82): the workspace's 50 newest ingested CI runs, filtered by the
   `?agent_id=&repo=` query only (the selectors and "Clear filters" just rewrite the
   URL, so the CI tab's History link and a reload show the same view), a manual Sync,
   and a silent automatic sync on open. No header statistics, no pagination. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useCiAutoSync, useCiRuns, useCiSync, type CiRunsFilters } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import { CiRunsTable } from "../CiRunsTable";
import { filtersHref, readFilters } from "./helpers";
import { s } from "./styles";

export function CiRunsView() {
  const t = useTranslations("ci");
  const search = useSearchParams();
  const router = useRouter();
  const filters = readFilters(search);
  const runsQ = useCiRuns(filters);
  useCiAutoSync();
  const sync = useCiSync();
  const agentsQ = useAgents();
  const { repos } = useActiveRepo();

  const setFilters = (next: CiRunsFilters) => router.replace(filtersHref(next));
  const filtered = !!(filters.agentId || filters.repo);

  const runSync = () =>
    sync.mutate(
      { mode: "manual" },
      {
        onSuccess: (res) => {
          if (res.errors.length > 0) notify.error(res.errors[0]!.message);
          else if (res.throttled > 0 && res.ingested === 0) notify.info(t("runs.throttled"));
          else notify.success(t("runs.synced", { count: res.ingested }));
        },
      },
    );

  // Selectors list the workspace's agents / repos, plus a URL value that is not among them.
  const agentOptions = [
    { value: "", label: t("runs.filters.allAgents") },
    ...(agentsQ.data ?? []).map((a) => ({ value: a.id, label: a.name })),
    ...(filters.agentId && !(agentsQ.data ?? []).some((a) => a.id === filters.agentId)
      ? [{ value: filters.agentId, label: filters.agentId }]
      : []),
  ];
  const repoOptions = [
    { value: "", label: t("runs.filters.allRepos") },
    ...repos.map((r) => ({ value: r.full_name, label: r.full_name })),
    ...(filters.repo && !repos.some((r) => r.full_name === filters.repo) ? [{ value: filters.repo, label: filters.repo }] : []),
  ];

  const runs = runsQ.data ?? [];
  let content: React.ReactNode;
  if (runsQ.isLoading) content = <Skeleton height={240} />;
  else if (runsQ.isError)
    content = (
      <ErrorState title={t("runs.loadError")} body={(runsQ.error as Error)?.message} onRetry={() => void runsQ.refetch()} />
    );
  else if (runs.length === 0 && filtered)
    content = (
      <EmptyState
        icon="Filter"
        title={t("runs.noMatchTitle")}
        body={t("runs.noMatchBody")}
        cta={t("runs.filters.clear")}
        onCta={() => setFilters({})}
      />
    );
  else if (runs.length === 0)
    content = (
      <EmptyState
        icon="GitBranch"
        title={t("runs.emptyTitle")}
        body={
          <>
            {t("runs.emptyBody")}{" "}
            <Link href="/agents">{t("runs.emptyCta")}</Link>
          </>
        }
      />
    );
  else content = <CiRunsTable runs={runs} />;

  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <div style={s.page}>
        <div style={s.head}>
          <div style={s.titleBlock}>
            <h1 style={s.title}>{t("runs.title")}</h1>
            <p style={s.subtitle}>{t("runs.subtitle")}</p>
          </div>
          <div style={s.headActions}>
            <Button kind="secondary" icon="RefreshCw" loading={sync.isPending} disabled={sync.isPending} onClick={runSync}>
              {sync.isPending ? t("runs.syncing") : t("runs.sync")}
            </Button>
          </div>
        </div>

        <div style={s.filters}>
          <div style={s.filter}>
            <span style={s.filterLabel}>{t("runs.filters.agent")}</span>
            <SelectInput
              mono={false}
              aria-label={t("runs.filters.agent")}
              value={filters.agentId ?? ""}
              onChange={(v) => setFilters({ ...filters, agentId: v || undefined })}
              options={agentOptions}
            />
          </div>
          <div style={s.filter}>
            <span style={s.filterLabel}>{t("runs.filters.repo")}</span>
            <SelectInput
              aria-label={t("runs.filters.repo")}
              value={filters.repo ?? ""}
              onChange={(v) => setFilters({ ...filters, repo: v || undefined })}
              options={repoOptions}
            />
          </div>
          {filtered && (
            <Button kind="ghost" icon="X" onClick={() => setFilters({})}>
              {t("runs.filters.clear")}
            </Button>
          )}
        </div>

        {content}
      </div>
    </AppShell>
  );
}
