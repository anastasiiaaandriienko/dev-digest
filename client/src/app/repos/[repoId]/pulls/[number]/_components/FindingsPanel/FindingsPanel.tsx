/* FindingsPanel — severity chips (multi-select filter) + hide-low-confidence +
   j/k navigation + FindingCard list, wiring the accept / reject decisions (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingActionKind, FindingRecord } from "@devdigest/shared";
import { countBySeverity } from "@/lib/findings";
import { FindingCard } from "../FindingCard";
import { SeverityChips } from "../SeverityChips";
import { useFindingAction, useFindingDecisionStatus } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { toggleSeverity, visibleFindings } from "./helpers";
import { activatePanel, ownsKeyboard, registerPanel } from "./keyboard-owner";
import { s } from "./styles";

/** A decision that would not change anything (no undo in L01) is not sent. */
function isNoop(f: FindingRecord, act: FindingActionKind): boolean {
  return (act === "accept" && !!f.accepted_at) || (act === "dismiss" && !!f.dismissed_at);
}

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  agentId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** The review's agent (null for agent-less reviews): enables "Turn into eval case". */
  agentId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const decisions = useFindingDecisionStatus();
  const panelId = React.useId();
  const [hideLow, setHideLow] = React.useState(false);
  const [severities, setSeverities] = React.useState<ReadonlySet<string>>(() => new Set());
  const [focusIdx, setFocusIdx] = React.useState(0);

  React.useEffect(() => registerPanel(panelId), [panelId]);

  // Counts are over ALL of this review's findings, so they stay stable while toggling.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const shown = React.useMemo(
    () => visibleFindings(findings, { hideLow, severities }),
    [findings, hideLow, severities],
  );
  const filtered = hideLow || severities.size > 0;

  // A filter change restarts navigation at the top of the new list; a shrinking
  // list (e.g. after a refetch) clamps the focus so j/k/a/d stay in range.
  React.useEffect(() => setFocusIdx(0), [hideLow, severities]);
  React.useEffect(() => {
    setFocusIdx((i) => Math.max(0, Math.min(i, shown.length - 1)));
  }, [shown.length]);

  const showAll = React.useCallback(() => {
    setSeverities(new Set());
    setHideLow(false);
  }, []);

  const decide = React.useCallback(
    (f: FindingRecord, act: FindingActionKind) => {
      if (decisions.get(f.id) === "pending" || isNoop(f, act)) return;
      action.mutate({ findingId: f.id, action: act, prId });
    },
    [action, decisions, prId],
  );

  // j/k navigation + a/d shortcuts on the focused finding of the FILTERED list —
  // only in the panel that owns the keyboard (one key press = one finding).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!ownsKeyboard(panelId)) return;
      if (e.key === "j") setFocusIdx((i) => Math.max(0, Math.min(i + 1, shown.length - 1)));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) decide(shown[focusIdx]!, KEY_TO_ACTION[e.key]!);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, decide, panelId]);

  return (
    <div
      data-testid="findings-panel"
      onPointerDownCapture={() => activatePanel(panelId)}
      onFocusCapture={() => activatePanel(panelId)}
    >
      <div style={s.toolbar}>
        <SeverityChips
          counts={counts}
          selected={severities}
          onToggle={(sev) => setSeverities((prev) => toggleSeverity(prev, sev))}
          onClear={() => setSeverities(new Set())}
        />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>
      {filtered && findings.length > 0 && (
        <div style={s.filterStatus} role="status">
          {t("panel.showing", { shown: shown.length, total: findings.length })}
          <button type="button" onClick={showAll} style={s.clearLink}>
            {t("panel.showAll")}
          </button>
        </div>
      )}

      <div style={s.list}>
        {shown.length === 0 ? (
          findings.length === 0 ? (
            <EmptyState icon="CheckCircle" title={t("panel.noFindingsTitle")} body={t("panel.noFindingsBody")} />
          ) : (
            <EmptyState
              icon="Filter"
              title={t("panel.noMatchTitle")}
              body={t("panel.noMatchBody")}
              cta={t("panel.showAll")}
              onCta={showAll}
            />
          )
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              decision={decisions.get(f.id)}
              repoFullName={repoFullName}
              headSha={headSha}
              canTurnIntoEvalCase={!!agentId}
              onAction={(act) => decide(f, act)}
            />
          ))
        )}
      </div>
    </div>
  );
}
