/* InstallationRow — one repository the agent is installed in (AC-CI-62, 64, 66, 67, 57):
   repo, target, status, last run, workflow version (outdated mark), the export PR while
   pending, Sync, History and Update CI config. Repo names and statuses are rendered as text. */
"use client";

import React from "react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { CiInstallationView } from "@devdigest/shared";
import { STATUS_TONE, ciRunsHref, isOutdated } from "../../helpers";
import { s } from "./styles";

export function InstallationRow({
  installation,
  agentId,
  agentVersion,
  syncing,
  onSync,
  onUpdate,
  updateDisabledReason,
}: {
  installation: CiInstallationView;
  agentId: string;
  agentVersion: number;
  syncing: boolean;
  onSync: () => void;
  onUpdate: () => void;
  /** Set while the export wizard cannot open (shown as the button's title). */
  updateDisabledReason?: string;
}) {
  const t = useTranslations("ci");
  const format = useFormatter();
  const now = useNow();
  const i = installation;
  const tone = STATUS_TONE[i.status];
  const lastRun =
    i.last_run_at && i.last_run_status
      ? t("ciTab.lastRun", {
          status: t.has(`ciTab.runStatus.${i.last_run_status}`) ? t(`ciTab.runStatus.${i.last_run_status}`) : i.last_run_status,
          time: format.relativeTime(new Date(i.last_run_at), now),
        })
      : t("ciTab.noRuns");

  return (
    <div style={s.row} data-testid="ci-installation" data-status={i.status}>
      <div style={s.top}>
        <span style={s.repo}>{i.repo}</span>
        <span style={s.target}>{t(`ciTab.target.${i.target_type}`)}</span>
        <Badge color={tone.color} bg={tone.bg} dot>
          {t(`ciTab.status.${i.status}`)}
        </Badge>
        <div style={s.actions}>
          <Button size="sm" kind="ghost" icon="RefreshCw" loading={syncing} disabled={syncing} onClick={onSync} aria-label={t("ciTab.syncLabel", { repo: i.repo })}>
            {t("ciTab.sync")}
          </Button>
          <Link href={ciRunsHref(agentId, i.repo)} style={s.link} aria-label={t("ciTab.historyLabel", { repo: i.repo })}>
            {t("ciTab.history")}
          </Link>
          <Button size="sm" kind="secondary" onClick={onUpdate} disabled={!!updateDisabledReason} title={updateDisabledReason}>
            {t("ciTab.updateConfig")}
          </Button>
        </div>
      </div>
      <div style={s.meta}>
        <span>{lastRun}</span>
        {i.agent_version != null && (
          <span style={isOutdated(i, agentVersion) ? s.outdated : undefined}>
            {t("ciTab.workflowVersion", { version: i.agent_version })}
            {isOutdated(i, agentVersion) && ` · ${t("ciTab.outdated", { version: agentVersion })}`}
          </span>
        )}
        {i.status === "pending" && i.pr_url && (
          <a href={i.pr_url} target="_blank" rel="noopener noreferrer" style={s.link}>
            {t("ciTab.openPr")}
          </a>
        )}
      </div>
      {i.status === "pending" && <div style={s.hint}>{t("ciTab.pendingHint")}</div>}
      {i.status === "error" && <div style={s.hint}>{t("ciTab.errorHint")}</div>}
    </div>
  );
}
