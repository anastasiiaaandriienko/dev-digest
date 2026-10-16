/* VersioningTab — every body snapshot of a skill (HW2 #27; design: Skill
   Editor · Versions), newest first. Versions store no message, so each row's
   title is derived from the bodies: initial version, a restore ("same body as
   vN") or the line delta against the previous version; then its timestamp and
   the Current badge; each older version can be diffed against
   the current body (#28) or restored (#29). Restoring creates a NEW version
   server-side (history is never rewritten); a body that is already current
   cannot be restored. While Config has unsaved edits Restore is blocked (it
   would replace the form and lose them) and a note says why. */
"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { VersionDiff } from "./_components/VersionDiff";
import { WHEN_FORMAT } from "./constants";
import { versionSummaries, versionWhen, type VersionSummary } from "./helpers";
import { s } from "./styles";

export function VersioningTab({
  skill,
  restoreBlocked = false,
}: {
  skill: Skill;
  /** Config has unsaved edits: restoring would throw them away, so it is blocked. */
  restoreBlocked?: boolean;
}) {
  const t = useTranslations("skills");
  const format = useFormatter(); // full date in the row tooltip (app locale); the row itself shows versionWhen
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffOf, setDiffOf] = React.useState<number | null>(null);

  const summaries = React.useMemo(() => versionSummaries(versions ?? []), [versions]);
  const current = versions?.find((v) => v.current);
  const summaryText = (sm: VersionSummary) =>
    sm.kind === "initial"
      ? t("detail.versioning.initial")
      : sm.kind === "same"
        ? t("detail.versioning.sameAs", { version: sm.as })
        : t("detail.versioning.changed", { added: sm.added, removed: sm.removed, prev: sm.prev });

  const doRestore = async (version: number) => {
    try {
      const result = await restore.mutateAsync({ id: skill.id, version });
      notify.success(
        result.restored
          ? t("detail.versioning.restored", { from: version, version: result.skill.version })
          : t("detail.versioning.alreadyCurrent", { from: version }),
      );
      setDiffOf(null);
    } catch {
      // The global MutationCache onError already shows the toast.
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.h2}>{t("detail.versioning.title")}</h2>
        {versions && (
          <Badge color="var(--text-secondary)">{t("detail.versioning.count", { count: versions.length })}</Badge>
        )}
      </div>
      <p style={s.subtitle}>{t("detail.versioning.subtitle")}</p>
      {restoreBlocked && (
        <p role="status" style={s.blocked} data-testid="restore-blocked">
          {t("detail.versioning.restoreBlocked")}
        </p>
      )}

      {isLoading && (
        <div style={s.list} aria-busy="true">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      )}
      {isError && !versions && <ErrorState body={t("detail.versioning.loadError")} onRetry={() => refetch()} />}
      {versions && versions.length === 0 && <p style={s.subtitle}>{t("detail.versioning.empty")}</p>}

      {versions && versions.length > 0 && (
        <ol style={s.list} aria-label={t("detail.versioning.title")}>
          {versions.map((v) => {
            const isSameAsCurrent = v.body === skill.body;
            const restoringThis = restore.isPending && restore.variables?.version === v.version;
            const open = diffOf === v.version;
            const summary = summaries.get(v.version);
            return (
              <li key={v.version} style={s.item(v.current)} data-version={v.version}>
                <div style={s.row}>
                  <span className="mono" style={s.chip(v.current)}>
                    {t("preview.version", { version: v.version })}
                  </span>
                  <div style={s.meta}>
                    {summary && <span style={s.title}>{summaryText(summary)}</span>}
                    <time
                      dateTime={v.created_at}
                      title={format.dateTime(new Date(v.created_at), WHEN_FORMAT)}
                      className="tnum"
                      style={s.when}
                    >
                      {versionWhen(v.created_at)}
                    </time>
                  </div>
                  {v.current ? (
                    <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                      {t("detail.versioning.current")}
                    </Badge>
                  ) : (
                    <div style={s.actions}>
                      <Button
                        kind="ghost"
                        size="sm"
                        icon="Eye"
                        aria-expanded={open}
                        onClick={() => setDiffOf(open ? null : v.version)}
                      >
                        {open ? t("detail.versioning.hideDiff") : t("detail.versioning.diff")}
                      </Button>
                      <Button
                        kind="secondary"
                        size="sm"
                        icon="History"
                        disabled={isSameAsCurrent || restore.isPending || restoreBlocked}
                        title={
                          isSameAsCurrent
                            ? t("detail.versioning.restoreSame")
                            : restoreBlocked
                              ? t("detail.versioning.restoreBlocked")
                              : undefined
                        }
                        onClick={() => doRestore(v.version)}
                      >
                        {restoringThis ? t("detail.versioning.restoring") : t("detail.versioning.restore")}
                      </Button>
                    </div>
                  )}
                </div>
                {open && current && (
                  <VersionDiff fromVersion={v.version} toVersion={current.version} before={v.body} after={current.body} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
