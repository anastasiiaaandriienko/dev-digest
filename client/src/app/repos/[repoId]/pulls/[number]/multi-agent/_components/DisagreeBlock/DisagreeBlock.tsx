/* DisagreeBlock — "Where agents disagree" (L07, AC-MAR-42..44, 54). Lists the
   server's conflicts (toggle ON, the default) or, with "Show only conflicts"
   OFF, also the groups flagged by ≥2 agents. Each row is file:line + title
   and one cell per agent from that row's server-side takes:
     severity  → severity badge + the finding title;
     ignored   → "did not flag" (the agent finished and did not flag it);
     no_result → "no result" (failed, cancelled or still running — no opinion).
   While an agent is still running the block says it is not final. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { AgentColumn, ConflictTake, MultiAgentRun } from "@devdigest/shared";
import { disagreeRows, isPartial, locationLabel, takeKind } from "./helpers";
import { s } from "./styles";

function TakeCell({ take }: { take: ConflictTake }) {
  const t = useTranslations("multiAgent");
  const kind = takeKind(take);
  return (
    <div style={s.cell} data-take={kind}>
      <span style={s.persona}>{take.persona}</span>
      {kind === "severity" ? (
        <>
          <span style={s.verdictRow}>
            <SeverityBadge severity={take.verdict as Severity} compact />
          </span>
          {take.note && <span style={s.note}>{take.note}</span>}
        </>
      ) : kind === "ignored" ? (
        <span style={s.ignored}>{t("disagree.didNotFlag")}</span>
      ) : (
        <span style={s.noResult}>{t("disagree.noResult")}</span>
      )}
    </div>
  );
}

export function DisagreeBlock({
  run,
  columns,
}: {
  run: Pick<MultiAgentRun, "groups" | "conflicts">;
  columns: readonly Pick<AgentColumn, "status">[];
}) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(true);
  const rows = disagreeRows(run, onlyConflicts);

  return (
    <section style={s.root} aria-label={t("disagree.heading")} data-testid="disagree-block">
      <div style={s.head}>
        <h2 style={s.heading}>{t("disagree.heading")}</h2>
        <span style={s.toggle}>
          <span aria-hidden="true">{t("disagree.showOnlyConflicts")}</span>
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} label={t("disagree.showOnlyConflicts")} />
        </span>
      </div>
      {isPartial(columns) && (
        <span style={s.partial} role="status">
          {t("disagree.partial")}
        </span>
      )}
      {rows.length === 0 ? (
        <span style={s.none}>{t("disagree.none")}</span>
      ) : (
        rows.map((r) => (
          <div key={r.key} style={s.row} data-testid="disagree-row" data-conflict={r.conflict}>
            <div style={s.rowHead}>
              <span className="mono" style={s.location}>
                {locationLabel(r)}
              </span>
              <span style={s.title}>{r.title}</span>
            </div>
            <div style={s.cells}>
              {r.takes.map((take, i) => (
                <TakeCell key={`${take.agent_id}-${i}`} take={take} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
