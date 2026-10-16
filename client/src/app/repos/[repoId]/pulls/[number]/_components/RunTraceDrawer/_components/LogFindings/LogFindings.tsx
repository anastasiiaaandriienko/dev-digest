/* LogFindings — findings context above the Live log (L01, client spec §6):
   the run's persisted severity counts (when it has them), what the log says
   about candidates / kept / dropped (works while the run is still live), and a
   toggle that narrows the log to finding-related lines. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { countBySeverity } from "@/lib/findings";
import { SeverityChips } from "../../../SeverityChips";
import type { LogFindingsSummary } from "../../helpers";

export function LogFindings({
  findings,
  summary,
  onlyFindings,
  onOnlyFindingsChange,
}: {
  findings: FindingRecord[];
  summary: LogFindingsSummary;
  onlyFindings: boolean;
  onOnlyFindingsChange: (on: boolean) => void;
}) {
  const t = useTranslations("runs");
  const parts: string[] = [];
  if (summary.candidates != null) parts.push(t("log.findings.candidates", { count: summary.candidates }));
  if (summary.reduced != null) parts.push(t("log.findings.reduced", { count: summary.reduced }));
  if (summary.dropped.length > 0) parts.push(t("log.findings.dropped", { count: summary.dropped.length }));

  return (
    <div
      data-testid="log-findings"
      style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {findings.length > 0 ? (
          <SeverityChips counts={countBySeverity(findings)} />
        ) : (
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("log.findings.nonePersisted")}</span>
        )}
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: "var(--text-secondary)",
          }}
        >
          {t("log.findings.onlyFindingLines")}
          <Toggle on={onlyFindings} onChange={onOnlyFindingsChange} size={16} />
        </label>
      </div>
      {parts.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{parts.join(" · ")}</div>
      )}
    </div>
  );
}
