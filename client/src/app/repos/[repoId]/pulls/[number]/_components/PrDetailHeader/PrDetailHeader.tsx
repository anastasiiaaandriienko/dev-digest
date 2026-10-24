"use client";

import React, { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@devdigest/ui";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { multiAgentResultsHref } from "@/lib/multi-agent";
import { s } from "./styles";
import type { PrDetail } from "@/lib/types";

interface PrDetailHeaderProps {
  pr: PrDetail;
  repoId: string;
  prId: string | null;
  tab: string;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: string) => void;
  onRunStart: () => void;
  onRunsStarted: () => void;
}

export function PrDetailHeader({
  pr,
  repoId,
  prId,
  tab,
  findingsCount,
  githubUrl,
  onSetTab,
  onRunStart,
  onRunsStarted,
}: PrDetailHeaderProps) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  // L07 AC-MAR-27: link to the latest multi-run's Results page, only when one exists.
  const { data: multiAgent } = useMultiAgentRun(prId);
  const hasMultiRun = !!multiAgent?.multi_run;

  const handleRunStart = useCallback(() => {
    onRunStart();
  }, [onRunStart]);

  const handleRunsStarted = useCallback(() => {
    onRunsStarted();
  }, [onRunsStarted]);

  const statusColor =
    pr.status === "merged"
      ? "var(--ok)"
      : pr.status === "closed"
        ? "var(--stale)"
        : "var(--warn)";

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
              <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
            </span>
            <Badge dot bg="transparent" color={statusColor}>
              {pr.status}
            </Badge>
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind="ghost"
            size="sm"
            icon="ExternalLink"
            disabled={!githubUrl}
            onClick={() =>
              githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")
            }
          >
            View on GitHub
          </Button>
          {hasMultiRun && (
            <Button
              kind="ghost"
              size="sm"
              icon="Users"
              onClick={() => router.push(multiAgentResultsHref(repoId, pr.number))}
            >
              {t("picker.latestRun")}
            </Button>
          )}
          {prId && (
            <RunReviewDropdown
              prId={prId}
              repoId={repoId}
              prNumber={pr.number}
              warnMerged={pr.status === "merged" || pr.status === "closed"}
              onRunStart={handleRunStart}
              onRunsStarted={handleRunsStarted}
            />
          )}
        </div>
      </div>
      {(pr.status === "merged" || pr.status === "closed") && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          <span>
            This PR is already {pr.status} — running a review is informational and won't affect the
            merged code.
          </span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: "Overview", icon: "FileText" },
          { key: "findings", label: "Agent runs", icon: "AlertOctagon", count: findingsCount || undefined },
          { key: "diff", label: "Files changed", icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
