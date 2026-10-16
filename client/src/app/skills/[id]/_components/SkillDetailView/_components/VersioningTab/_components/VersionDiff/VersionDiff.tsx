/* VersionDiff — line-by-line diff of one historical body against the current
   body (HW2 #28). Lines are computed by `diffLines` (LCS, no dependency) and
   rendered with the PR diff viewer's CodeLine, so add / remove colours match. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CodeLine } from "@/components/diff-viewer";
import { diffLines } from "./helpers";
import { s } from "./styles";

export function VersionDiff({
  fromVersion,
  toVersion,
  before,
  after,
}: {
  fromVersion: number;
  toVersion: number;
  /** Body of the historical version. */
  before: string;
  /** Body of the current version. */
  after: string;
}) {
  const t = useTranslations("skills");
  const diff = React.useMemo(() => diffLines(before, after), [before, after]);
  const identical = diff.added === 0 && diff.removed === 0;

  return (
    <section style={s.wrap} aria-label={t("detail.diff.label", { from: fromVersion })} data-testid="version-diff">
      <div style={s.header}>
        <span className="mono" style={s.title}>
          {t("detail.diff.title", { from: fromVersion, to: toVersion })}
        </span>
        <span className="mono tnum" style={s.stats} data-testid="version-diff-stats">
          <span style={s.added}>+{diff.added}</span> <span style={s.removed}>−{diff.removed}</span>
        </span>
      </div>
      {identical ? (
        <div style={s.identical}>{t("detail.diff.identical")}</div>
      ) : (
        <div style={s.lines}>
          {diff.lines.map((ln, i) => (
            <div key={i} data-diff-kind={ln.kind}>
              <CodeLine ln={ln} path="" threads={[]} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
