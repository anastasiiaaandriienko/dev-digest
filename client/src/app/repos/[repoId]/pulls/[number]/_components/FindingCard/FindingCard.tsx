/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. L06: a decided finding of an agent can be turned into an eval
   case (must find / must not flag); the modal mounts only when opened. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { AddToEvalModal } from "../AddToEvalModal";
import { evalKindOf } from "../AddToEvalModal/helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  decision,
  repoFullName,
  headSha,
  canTurnIntoEvalCase,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  /** Disable the decision buttons (e.g. while a request is in flight). */
  pending?: boolean;
  /** Latest decision request status for THIS finding. */
  decision?: "pending" | "error" | "success";
  repoFullName?: string | null;
  headSha?: string | null;
  /** L06: the finding belongs to an agent, so a decided one can become an eval case. */
  canTurnIntoEvalCase?: boolean;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;
  const busy = !!pending || decision === "pending";
  const evalKind = canTurnIntoEvalCase ? evalKindOf(f) : null;
  const inEvalSet = !!f.eval_case_id;
  const [evalOpen, setEvalOpen] = React.useState(false);

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            {/* Reject = the server's "dismiss". A button for the decision the
                finding already has is disabled: there is no undo in L01. */}
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={busy || accepted}
              active={accepted}
              aria-pressed={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={busy || dismissed}
              active={dismissed}
              aria-pressed={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            {evalKind && (
              <span style={s.evalGroup}>
                {inEvalSet ? (
                  <span data-testid="eval-case-badge" title={t("finding.evalCase.inEvalSetTitle")} style={s.evalBadge}>
                    <Icon.FlaskConical size={13} />
                    {t("finding.evalCase.inEvalSet")}
                  </span>
                ) : (
                  <Button
                    kind="ghost"
                    size="sm"
                    icon="FlaskConical"
                    disabled={busy}
                    title={t(evalKind === "must_find" ? "finding.evalCase.titleMustFind" : "finding.evalCase.titleMustNotFlag")}
                    onClick={() => setEvalOpen(true)}
                  >
                    {t("finding.evalCase.turnInto")}
                  </Button>
                )}
                <span data-testid="eval-kind-pill" style={s.evalKindPill(evalKind)}>
                  {t(`finding.evalCase.kind.${evalKind}`)}
                </span>
              </span>
            )}
            {decision && (
              <span role="status" aria-live="polite" style={s.decisionStatus(decision)}>
                {t(`finding.decision.${decision}`)}
              </span>
            )}
          </div>
        </div>
      )}
      {evalOpen && evalKind && !inEvalSet && <AddToEvalModal finding={f} onClose={() => setEvalOpen(false)} />}
    </div>
  );
}
