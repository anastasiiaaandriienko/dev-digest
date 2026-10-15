/* SeverityChips — per-severity finding counts. Interactive (multi-select filter
   with an "All" reset) when `onToggle` is given; read-only otherwise (Trace
   drawer). Counts are always over ALL findings, so they stay stable while the
   user toggles filters. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import { severityKeys, type SeverityCounts, type SeverityKey } from "@/lib/findings";
import { s } from "./styles";

export function SeverityChips({
  counts,
  selected,
  onToggle,
  onClear,
}: {
  counts: SeverityCounts;
  /** Selected severities; empty = all. Ignored when read-only. */
  selected?: ReadonlySet<string>;
  /** Toggle one severity. Omit for a read-only summary. */
  onToggle?: (severity: SeverityKey) => void;
  /** Reset to all severities. */
  onClear?: () => void;
}) {
  const t = useTranslations("prReview");
  const keys = severityKeys(counts);
  const total = keys.reduce((n, k) => n + counts[k], 0);
  const interactive = !!onToggle;
  const noneSelected = !selected || selected.size === 0;

  if (!interactive) {
    return (
      <div style={s.row} aria-label={t("severity.summaryLabel")}>
        {keys.map((k) => {
          const I = Icon[SEV[k].icon];
          return (
            <span key={k} style={s.readOnly(SEV[k].c, SEV[k].bg, counts[k] === 0)} data-severity={k}>
              <I size={12} />
              {t(`severity.${k}`)}
              <span className="tnum">{counts[k]}</span>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div style={s.row} role="group" aria-label={t("severity.filterLabel")}>
      <button
        type="button"
        aria-pressed={noneSelected}
        onClick={onClear}
        style={s.chip(noneSelected, "var(--accent-text)", "var(--accent-bg)")}
        title={t("severity.allHint")}
      >
        {t("severity.all")}
        <span className="tnum" style={s.count}>
          {total}
        </span>
      </button>
      {keys.map((k) => {
        const active = !!selected?.has(k);
        const I = Icon[SEV[k].icon];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={active}
            data-severity={k}
            onClick={() => onToggle(k)}
            style={s.chip(active, SEV[k].c, SEV[k].bg, counts[k] === 0)}
            title={t(active ? "severity.removeHint" : "severity.addHint", { severity: t(`severity.${k}`) })}
          >
            <I size={13} style={{ color: SEV[k].c }} />
            {t(`severity.${k}`)}
            <span className="tnum" style={s.count}>
              {counts[k]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
