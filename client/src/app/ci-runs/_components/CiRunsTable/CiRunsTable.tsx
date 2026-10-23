/* CiRunsTable — ingested CI runs, newest first (AC-CI-51, 54, 76): repository, PR,
   agent, verdict, findings, cost ("—" when unknown), duration, short commit SHA, when
   it ran and the GitHub Actions job link. Everything from GitHub / the artifact is
   rendered as text; the job link is only the API's GitHub https URL. */
"use client";

import React from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { fmtCost } from "@/lib/evals";
import { VERDICT_TONE, fmtDuration, safeJobUrl, shortSha } from "../CiRunsView/helpers";
import { s } from "./styles";

export function CiRunsTable({ runs }: { runs: readonly CiRun[] }) {
  const t = useTranslations("ci");
  const format = useFormatter();
  const now = useNow();
  const none = t("runs.none");
  const headers = ["repo", "pr", "agent", "verdict", "findings", "cost", "duration", "commit", "ranAt", "job"] as const;

  return (
    <div style={s.table} role="table" aria-label={t("runs.table.label")}>
      <div style={s.head} role="row">
        {headers.map((h) => (
          <div key={h} role="columnheader">
            {t(`runs.table.${h}`)}
          </div>
        ))}
      </div>
      {runs.map((r) => {
        const job = safeJobUrl(r.github_url);
        const sha = shortSha(r.commit_sha);
        const tone = r.verdict ? VERDICT_TONE[r.verdict] : null;
        return (
          <div key={r.id} role="row" style={s.row} data-testid="ci-run-row" data-verdict={r.verdict ?? ""}>
            <div role="cell" style={s.mono} title={r.repo ?? undefined}>
              {r.repo ?? none}
            </div>
            <div role="cell" style={s.mono}>
              {r.pr_number != null ? `#${r.pr_number}` : none}
            </div>
            <div role="cell">{r.agent ?? none}</div>
            <div role="cell">
              {tone && r.verdict ? (
                <Badge color={tone.color} bg={tone.bg} dot>
                  {t(`runs.verdict.${r.verdict}`)}
                </Badge>
              ) : (
                none
              )}
            </div>
            <div role="cell">{r.findings_count ?? none}</div>
            <div role="cell">{fmtCost(r.cost_usd, none)}</div>
            <div role="cell">{fmtDuration(r.duration_s) ?? none}</div>
            <div role="cell" style={s.mono} title={r.commit_sha ?? undefined}>
              {sha ?? none}
            </div>
            <div role="cell" style={s.muted}>
              {r.ran_at ? format.relativeTime(new Date(r.ran_at), now) : none}
            </div>
            <div role="cell">
              {job ? (
                <a
                  href={job}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.link}
                  aria-label={t("runs.viewJobLabel", { repo: r.repo ?? "", sha: sha ?? "" })}
                >
                  {t("runs.viewJob")}
                </a>
              ) : (
                none
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
