/* TabsView — Tabs mode of the Results page (AC-MAR-37..41): one tab per agent
   (name + score); the selected agent's header (score ring, summary, View
   trace, time, cost) and its findings as the shared FindingCard (Accept /
   Dismiss through the existing finding actions, "Turn into eval case" under
   AddToEvalModal's own preconditions). "Learn" is a disabled button with an
   explanation; there is no "Reply to author". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, CircularScore, Tabs } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { formatEstimateDuration } from "@/app/repos/[repoId]/multi-agent/_components/ConfigureRun/helpers";
import { useFindingAction, useFindingDecisionStatus } from "@/lib/hooks/reviews";
import { formatCost } from "@/lib/format";
import { toFindingRecord } from "../ResultsView/helpers";
import { s } from "./styles";

export function TabsView({
  columns,
  prId,
  repoFullName,
  headSha,
  onViewTrace,
}: {
  columns: AgentColumn[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const action = useFindingAction();
  const decisions = useFindingDecisionStatus();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = columns.find((c) => c.run_id === selectedId) ?? columns[0];
  if (!selected) return null;

  const learn = (
    <span title={t("actions.learnUnavailable")}>
      <Button kind="ghost" size="sm" icon="Lightbulb" disabled aria-disabled="true">
        {t("actions.learn")}
      </Button>
    </span>
  );

  return (
    <div style={s.wrap}>
      <Tabs
        pad="0"
        value={selected.run_id}
        onChange={setSelectedId}
        tabs={columns.map((c) => ({
          key: c.run_id,
          label: c.agent_name,
          ...(c.score != null ? { count: c.score } : {}),
        }))}
      />

      <div style={s.agentHead} data-testid="tab-agent-head">
        {selected.score != null && <CircularScore score={selected.score} size={44} />}
        <div style={s.agentMain}>
          <span style={s.agentName}>{selected.agent_name}</span>
          {selected.summary && <span style={s.summary}>{selected.summary}</span>}
          {selected.status === "running" && <span style={s.status}>{t("status.running")}</span>}
          {(selected.status === "failed" || selected.status === "cancelled") && (
            <span style={s.failed} role="alert">
              {t(`status.${selected.status}`)}: {selected.error || t("status.noError")}
            </span>
          )}
        </div>
        <div style={s.meta}>
          <Button kind="ghost" size="sm" icon="Eye" onClick={() => onViewTrace(selected.run_id)}>
            {t("results.viewTrace")}
          </Button>
          <span>
            {formatEstimateDuration(selected.duration_ms)} · {formatCost(selected.cost_usd)}
          </span>
        </div>
      </div>

      <div style={s.findings}>
        {selected.findings.length === 0 ? (
          selected.status === "done" && <span style={s.empty}>{t("results.noFindings")}</span>
        ) : (
          selected.findings.map((f, i) => (
            <FindingCard
              key={f.id}
              f={toFindingRecord(f)}
              defaultExpanded={i === 0}
              decision={decisions.get(f.id)}
              repoFullName={repoFullName}
              headSha={headSha}
              canTurnIntoEvalCase={!!selected.agent_id}
              onAction={(act) => {
                if (decisions.get(f.id) === "pending") return;
                action.mutate({ findingId: f.id, action: act, prId });
              }}
              extraActions={learn}
            />
          ))
        )}
      </div>
    </div>
  );
}
