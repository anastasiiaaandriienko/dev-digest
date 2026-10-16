/* InlineFinding — one finding card under its diff line: agent label, the shared
   FindingCard (expanded; dismissed/accepted ones render muted), accept/dismiss
   via useFindingAction, and an × that hides the card locally (no request). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { useFindingAction, useFindingDecisionStatus } from "@/lib/hooks/reviews";
import { FindingCard } from "../../../FindingCard";
import { s } from "./styles";

/** A decision that would not change anything (no undo in L01) is not sent. */
function isNoop(f: FindingRecord, act: FindingActionKind): boolean {
  return (act === "accept" && !!f.accepted_at) || (act === "dismiss" && !!f.dismissed_at);
}

export function InlineFinding({
  f,
  agentName,
  prId,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  agentName?: string | null;
  prId: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const decisions = useFindingDecisionStatus();
  const [hidden, setHidden] = React.useState(false);

  if (hidden) return null;

  const decide = (act: FindingActionKind) => {
    if (decisions.get(f.id) === "pending" || isNoop(f, act)) return;
    action.mutate({ findingId: f.id, action: act, prId: prId ?? undefined });
  };

  return (
    <div style={s.wrap}>
      {agentName && <div style={s.agent}>{t("smartDiff.agentLabel", { agent: agentName })}</div>}
      <button
        type="button"
        aria-label={t("smartDiff.hideCard")}
        title={t("smartDiff.hideCard")}
        onClick={() => setHidden(true)}
        style={s.hide}
      >
        <Icon.X size={14} />
      </button>
      <FindingCard
        f={f}
        defaultExpanded
        decision={decisions.get(f.id)}
        repoFullName={repoFullName}
        headSha={headSha}
        onAction={decide}
      />
    </div>
  );
}
