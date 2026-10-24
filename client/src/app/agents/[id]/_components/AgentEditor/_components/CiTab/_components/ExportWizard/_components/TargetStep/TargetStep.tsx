/* TargetStep — wizard step 1 (AC-CI-03..05, 63, 64): the target repository (workspace
   repos, default = the active repo; fixed when updating an installation), the CI target
   cards (GitHub Actions selected and recommended, the others disabled) and the occupancy
   warning when another agent already runs in CI on that repository. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SelectInput } from "@devdigest/ui";
import type { CiInstallationView, CiTarget } from "@devdigest/shared";
import { TARGETS } from "../../constants";
import { s } from "./styles";

export function TargetStep({
  mode,
  repo,
  repos,
  target,
  onRepo,
  occupiedBy,
  checking,
  checkFailed,
}: {
  mode: "add" | "update";
  repo: string;
  /** Workspace repositories (`owner/name`). */
  repos: readonly string[];
  target: CiTarget;
  onRepo: (repo: string) => void;
  occupiedBy: CiInstallationView | null;
  checking: boolean;
  checkFailed: boolean;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.wrap}>
      <div>
        <div style={s.label}>{t("exportWizard.repoLabel")}</div>
        {mode === "update" ? (
          <div style={s.locked} data-testid="wizard-repo-locked">
            {repo}
          </div>
        ) : repos.length === 0 ? (
          <div style={s.hint}>{t("exportWizard.noRepos")}</div>
        ) : (
          <SelectInput
            aria-label={t("exportWizard.repoLabel")}
            value={repo}
            onChange={onRepo}
            options={[
              ...(repo ? [] : [{ value: "", label: t("exportWizard.repoPlaceholder") }]),
              ...repos.map((r) => ({ value: r, label: r })),
            ]}
          />
        )}
        <div style={s.hint}>
          {mode === "update" ? t("exportWizard.repoLocked", { repo }) : t("exportWizard.repoHint")}
        </div>
      </div>

      <div style={s.cards} role="radiogroup" aria-label={t("exportWizard.steps.target")}>
        {TARGETS.map(({ key, available }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === target}
            disabled={!available}
            style={s.card(key === target, available)}
          >
            <span style={s.cardTitle}>
              {t(`exportWizard.targets.${key}`)}
              {key === "gha" && (
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {t("exportWizard.recommended")}
                </Badge>
              )}
            </span>
            <span style={s.cardDesc}>
              {available ? t(`exportWizard.targets.${key}Desc`) : t("exportWizard.notAvailable")}
            </span>
          </button>
        ))}
      </div>

      {checking && <div style={s.hint}>{t("exportWizard.checkingRepo")}</div>}
      {checkFailed && (
        <div style={s.warning} role="alert">
          {t("exportWizard.occupiedCheckFailed")}
        </div>
      )}
      {occupiedBy && (
        <div style={s.warning} role="alert">
          {t("exportWizard.occupied", { repo, agent: occupiedBy.agent_name })}
        </div>
      )}
    </div>
  );
}
