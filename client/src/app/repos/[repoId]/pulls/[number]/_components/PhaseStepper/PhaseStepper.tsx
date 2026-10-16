/* PhaseStepper — the five review lifecycle phases (Initiation → Completion)
   of ONE run, derived by `phasesFrom` (src/lib/run-phases.ts) from the run's
   real events and status. Purely presentational. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PhaseState, RunPhases } from "@/lib/run-phases";
import { s } from "./styles";

const STATE_ICON: Record<PhaseState, keyof typeof Icon> = {
  pending: "Clock",
  active: "RefreshCw",
  completed: "CheckCircle",
  skipped: "Slash",
  failed: "XCircle",
};

export function PhaseStepper({ result, label }: { result: RunPhases; label?: string | null }) {
  const t = useTranslations("prReview");
  return (
    <div style={s.wrap} data-testid="phase-stepper" data-outcome={result.outcome}>
      {label && <div style={s.label}>{label}</div>}
      <ol style={s.list} aria-label={t("phases.label")}>
        {result.phases.map((p, i) => {
          const I = Icon[STATE_ICON[p.state]];
          const stateText = p.cancelled ? t("phases.state.cancelled") : t(`phases.state.${p.state}`);
          const showProgress = p.key === "implementation" && result.progress && p.state !== "pending";
          return (
            <li
              key={p.key}
              data-phase={p.key}
              data-state={p.state}
              aria-current={p.state === "active" ? "step" : undefined}
              aria-label={`${t(`phases.${p.key}`)}: ${stateText}`}
              style={s.item}
            >
              <I size={14} style={s.icon(p.state)} />
              <span style={s.name(p.state)}>{t(`phases.${p.key}`)}</span>
              {(p.state === "failed" || p.state === "active" || p.state === "skipped") && (
                <span style={s.stateTag(p.state)}>{stateText}</span>
              )}
              {showProgress && (
                <span style={s.progress}>
                  {t("phases.fileProgress", { started: result.progress!.started, total: result.progress!.total })}
                </span>
              )}
              {i < result.phases.length - 1 && <span style={s.sep} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {result.outcome === "failed" && result.phases.every((p) => p.state === "pending") && (
        <div style={s.note}>{t("phases.failedNoLog")}</div>
      )}
    </div>
  );
}
