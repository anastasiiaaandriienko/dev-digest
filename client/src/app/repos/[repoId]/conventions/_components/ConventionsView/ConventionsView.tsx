/* /repos/:repoId/conventions — Conventions Extractor (HW2 #44–#52, design N7).
   "Run Scan" (first extraction) and "ReScan" are separate actions; while a
   scan runs the page polls and shows its progress; a failed scan shows why
   (decisions are kept). Candidates are reviewed with Accept / Reject / inline
   Edit; rejected ones leave the list (and stay out after a reload or a
   rescan). "Create skill" appears once something is accepted and opens the
   editable repo-conventions draft. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { ConventionUpdate } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useConventions, useStartConventionScan, useUpdateConvention } from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConventionCard } from "../ConventionCard";
import { CreateConventionSkillModal } from "../CreateConventionSkillModal";
import { SKELETON_CARDS } from "./constants";
import { relativeAgo, scanActions } from "./helpers";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const t = useTranslations("conventions");
  const { repos } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const start = useStartConventionScan(repoId);
  const update = useUpdateConvention(repoId);
  const [creating, setCreating] = React.useState(false);

  const repoName = repos.find((r) => r.id === repoId)?.full_name ?? t("page.repoFallback");
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const scan = data?.scan ?? null;
  const candidates = data?.candidates ?? [];
  const counts = data?.counts ?? { pending: 0, accepted: 0, rejected: 0 };
  const actions = scanActions(scan, start.isPending);
  const ago = (iso: string) => {
    const r = relativeAgo(iso, Date.now());
    return r.key === "justNow" ? t("page.justNow") : t(`page.${r.key}`, { count: r.count });
  };
  const summary = () => {
    if (scan?.status !== "done" || !scan.finished_at) return t("page.subtitle");
    const when = ago(scan.finished_at);
    const files = scan.sample_files.length;
    const last = scan.model ? t("page.lastScan", { when, files, model: scan.model }) : t("page.lastScanNoModel", { when, files });
    return `${last} · ${t("page.scanAdded", { count: scan.candidates_added ?? 0 })}`;
  };
  const runScan = (rescan: boolean) => start.mutate(rescan);
  const decide = (id: string) => (patch: ConventionUpdate) => update.mutateAsync({ id, patch });

  return (
    <AppShell crumb={crumb}>
      {creating && (
        <CreateConventionSkillModal repoId={repoId} repoName={repoName} onClose={() => setCreating(false)} />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.grow}>
            <h1 style={s.title}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repo}>
                {repoName}
              </span>
            </h1>
            <p style={s.subtitle} data-testid="scan-summary">
              {summary()}
            </p>
          </div>
          <div style={s.headerActions}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              onClick={() => runScan(false)}
              disabled={!actions.canRun}
              title={t("page.runScanHint")}
            >
              {t("page.runScan")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              onClick={() => runScan(true)}
              disabled={!actions.canRescan}
              title={t("page.rescanHint")}
            >
              {t("page.rescan")}
            </Button>
          </div>
        </div>

        {scan?.status === "running" && (
          <div role="status" style={s.banner("accent")} data-testid="scan-running">
            <Icon.RefreshCw size={15} style={s.spin} />
            <div>
              <div style={s.bannerTitle}>{t("page.scanning")}</div>
              <div style={s.bannerBody}>{t("page.scanningBody", { model: scan.model ?? "…" })}</div>
            </div>
          </div>
        )}
        {scan?.status === "failed" && (
          <div role="alert" style={s.banner("crit")} data-testid="scan-failed">
            <Icon.AlertTriangle size={15} style={s.bannerIcon} />
            <div>
              <div style={s.bannerTitle}>{t("page.extractionFailed")}</div>
              <div style={s.bannerBody}>{scan.error}</div>
              <div style={s.bannerHint}>{t("page.extractionFailedHint")}</div>
            </div>
          </div>
        )}

        {isLoading && (
          <div style={s.list} aria-busy="true">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={150} />
            ))}
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {data && !scan && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => runScan(false)}
            ctaLoading={start.isPending}
          />
        )}
        {data && scan && scan.status !== "running" && candidates.length === 0 && (
          <EmptyState icon="ListChecks" title={t("page.noPending.title")} body={t("page.noPending.body")} />
        )}

        {candidates.length > 0 && (
          <>
            <div style={s.toolbar}>
              <span style={s.count} data-testid="accepted-count">
                {t("page.acceptedCount", { accepted: counts.accepted, total: candidates.length })}
              </span>
              {counts.rejected > 0 && <span style={s.hidden}>· {t("page.rejectedHidden", { count: counts.rejected })}</span>}
              {counts.accepted > 0 && (
                <div style={s.toolbarEnd}>
                  <Button kind="primary" size="sm" icon="Sparkles" onClick={() => setCreating(true)}>
                    {t("page.createSkill")}
                  </Button>
                </div>
              )}
            </div>
            <ul style={s.list} aria-label={t("page.candidatesLabel")}>
              {candidates.map((c) => (
                <ConventionCard key={c.id} candidate={c} onUpdate={decide(c.id)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
