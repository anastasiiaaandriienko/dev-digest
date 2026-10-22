/* EvalCaseRow — one eval case (design components2.jsx `EvalCaseRow`): status icon
   of its latest result, mono name, kind pill, expected location + latest
   outcome, expected badge (severity · category, or "assert empty"). Read-only:
   cases are created from findings; editing / deleting are out of scope (spec §3). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { AgentEvalCase } from "@devdigest/shared";
import { caseStatus, expectedLocation } from "@/lib/evals";
import { s } from "./styles";

const STATUS_ICON = { pass: "CheckCircle", fail: "XCircle", never: "Dot" } as const;
const STATUS_COLOR = { pass: "var(--ok)", fail: "var(--crit)", never: "var(--text-muted)" } as const;

export function EvalCaseRow({ c }: { c: AgentEvalCase }) {
  const t = useTranslations("eval");
  const status = caseStatus(c.last_result?.outcome);
  const I = Icon[STATUS_ICON[status]];
  const outcome = c.last_result ? t(`evalsTab.outcome.${c.last_result.outcome}`) : t("evalsTab.outcome.never");
  return (
    <div style={s.row} data-testid="eval-case-row" data-status={status}>
      <I size={15} style={{ color: STATUS_COLOR[status], flexShrink: 0 }} aria-label={status} />
      <div style={s.main}>
        <div style={s.titleRow}>
          <span className="mono" style={s.name}>
            {c.name}
          </span>
          <span style={s.kindPill(c.kind)}>{t(`evalsTab.kind.${c.kind}`)}</span>
        </div>
        <div style={s.sub}>
          <span className="mono">{expectedLocation(c)}</span>
          {" · "}
          <span data-testid="eval-case-outcome">{outcome}</span>
        </div>
      </div>
      <Badge color="var(--text-muted)">
        {c.kind === "must_find" ? `${c.expected.severity} · ${c.expected.category}` : t("evalsTab.expectedEmpty")}
      </Badge>
    </div>
  );
}
