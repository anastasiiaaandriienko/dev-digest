/* ConfigureStep — wizard step 3 (AC-CI-09..13, 79): trigger chips (≥ 1), the secrets the
   workflow expects with static badges (no secret value is ever requested or shown), how
   results are posted (PR comment preselected; GitHub review needs a repo setting) and how
   merge blocking works. "Fail CI on" belongs to the agent (saved on the CI tab, AC-CI-65):
   it is shown here, not edited. If the workflow was edited, changing an option first asks
   to regenerate it; Cancel keeps the previous option (AC-CI-10). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@devdigest/ui";
import type { CiFailOn, CiPostAs, CiTrigger } from "@devdigest/shared";
import { toggleTrigger } from "../../helpers";
import { s } from "./styles";

const ALL_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
const POST_AS: readonly { value: CiPostAs; labelKey: string }[] = [
  { value: "pr_comment", labelKey: "prComment" },
  { value: "github_review", labelKey: "githubReview" },
  { value: "none", labelKey: "none" },
];
const SECRETS: readonly { key: string; badge: "secretRequired" | "secretAutoProvided" }[] = [
  { key: "OPENROUTER_API_KEY", badge: "secretRequired" },
  { key: "GITHUB_TOKEN", badge: "secretAutoProvided" },
];

type OptionsChange = { triggers?: CiTrigger[]; postAs?: CiPostAs };

export function ConfigureStep({
  triggers,
  postAs,
  failOn,
  workflowEdited,
  onChange,
}: {
  triggers: readonly CiTrigger[];
  postAs: CiPostAs;
  /** The agent's current "Fail CI on" (read-only here). */
  failOn: CiFailOn;
  workflowEdited: boolean;
  onChange: (change: OptionsChange) => void;
}) {
  const t = useTranslations("ci");
  const ta = useTranslations("agents");
  const [pending, setPending] = React.useState<OptionsChange | null>(null);

  const request = (change: OptionsChange) => {
    if (workflowEdited) setPending(change);
    else onChange(change);
  };

  return (
    <div style={s.wrap}>
      <div style={s.section}>
        <div style={s.label}>{t("exportWizard.triggerLabel")}</div>
        <div style={s.chips} role="group" aria-label={t("exportWizard.triggerLabel")}>
          {ALL_TRIGGERS.map((trigger) => {
            const on = triggers.includes(trigger);
            return (
              <button
                key={trigger}
                type="button"
                aria-pressed={on}
                style={s.chip(on)}
                onClick={() => request({ triggers: toggleTrigger(triggers, trigger) })}
              >
                {t(`exportWizard.triggers.${trigger}`)}
              </button>
            );
          })}
        </div>
        {triggers.length === 0 ? (
          <div style={s.error} role="alert">
            {t("exportWizard.triggersRequired")}
          </div>
        ) : (
          <div style={s.hint}>{t("exportWizard.triggersHint")}</div>
        )}
      </div>

      {pending && (
        <div style={s.confirm} role="alertdialog" aria-label={t("exportWizard.regenerateTitle")}>
          <span>
            <strong>{t("exportWizard.regenerateTitle")}</strong> {t("exportWizard.regenerateBody")}
          </span>
          <div style={s.confirmActions}>
            <Button size="sm" kind="ghost" onClick={() => setPending(null)}>
              {t("exportWizard.cancel")}
            </Button>
            <Button
              size="sm"
              kind="primary"
              onClick={() => {
                onChange(pending);
                setPending(null);
              }}
            >
              {t("exportWizard.regenerate")}
            </Button>
          </div>
        </div>
      )}

      <div style={s.section}>
        <div style={s.label}>{t("exportWizard.secretsTitle")}</div>
        {SECRETS.map(({ key, badge }) => (
          <div key={key} style={s.secretRow}>
            <span>{key}</span>
            <Badge>{t(`exportWizard.${badge}`)}</Badge>
          </div>
        ))}
        <div style={s.hint}>{t("exportWizard.secretsHint")}</div>
      </div>

      <div style={s.section} role="radiogroup" aria-label={t("exportWizard.postResultsLabel")}>
        <div style={s.label}>{t("exportWizard.postResultsLabel")}</div>
        {POST_AS.map(({ value, labelKey }) => (
          <label key={value} style={s.radio}>
            <input
              type="radio"
              name="ci-post-as"
              value={value}
              checked={postAs === value}
              onChange={() => request({ postAs: value })}
            />
            {t(`exportWizard.postAs.${labelKey}`)}
          </label>
        ))}
        {postAs === "github_review" && <div style={s.hint}>{t("exportWizard.githubReviewNote")}</div>}
      </div>

      <div style={s.info}>
        <strong>{t("exportWizard.blockMergeTitle")}.</strong>{" "}
        {t("exportWizard.blockMergeDesc", { failOn: ta(`config.ciFailOnOptions.${failOn}`) })}
      </div>
    </div>
  );
}
