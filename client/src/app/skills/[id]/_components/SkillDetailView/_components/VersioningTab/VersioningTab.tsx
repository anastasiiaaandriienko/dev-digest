/* VersioningTab — every body snapshot of a skill (HW2 #27), newest first, with
   its timestamp and the Current badge; each older version can be diffed against
   the current body (#28) or restored (#29). Restoring creates a NEW version
   server-side (history is never rewritten); a body that is already current
   cannot be restored. */
"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useRestoreSkillVersion, useSkillVersions } from "@/lib/hooks/skills";
import { notify } from "@/lib/toast";
import { VersionDiff } from "./_components/VersionDiff";
import { WHEN_FORMAT } from "./constants";
import { sameBodyAs } from "./helpers";
import { s } from "./styles";

export function VersioningTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const format = useFormatter(); // the app locale (next-intl), not the browser's
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffOf, setDiffOf] = React.useState<number | null>(null);

  const same = React.useMemo(() => sameBodyAs(versions ?? []), [versions]);
  const current = versions?.find((v) => v.current);

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
            const sameAs = same.get(v.version);
            return (
              <li key={v.version} style={s.item(v.current)} data-version={v.version}>
                <div style={s.row}>
                  <span className="mono" style={s.chip(v.current)}>
                    {t("preview.version", { version: v.version })}
                  </span>
                  <div style={s.meta}>
                    <time dateTime={v.created_at} style={s.when}>
                      {format.dateTime(new Date(v.created_at), WHEN_FORMAT)}
                    </time>
                    {sameAs !== undefined && (
                      <span style={s.note}>{t("detail.versioning.sameAs", { version: sameAs })}</span>
                    )}
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
                        disabled={isSameAsCurrent || restore.isPending}
                        title={isSameAsCurrent ? t("detail.versioning.restoreSame") : undefined}
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
