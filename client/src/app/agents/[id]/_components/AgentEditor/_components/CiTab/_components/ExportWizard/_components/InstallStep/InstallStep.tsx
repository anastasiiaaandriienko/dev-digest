/* InstallStep — wizard step 4 (AC-CI-14, 16, 17, 84): "Open a PR with these files"
   (default; "Update the existing PR" for an installed repo) naming the repo and the real
   file count, or "Copy files as a zip"; the GitHub Docs secrets link; and, after a failed
   install, the server's message with a hint for its error code. Install itself is the
   wizard's footer button. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

export type InstallMethod = "pr" | "zip";

/** GitHub Docs page linked from the Install step (Q28, AC-CI-84). */
export const SECRETS_HELP_URL =
  "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions";

export interface InstallError {
  message: string;
  code?: string;
}

export function InstallStep({
  mode,
  repo,
  fileCount,
  method,
  onMethod,
  disabled,
  error,
}: {
  mode: "add" | "update";
  repo: string;
  /** Files of the preview for the current settings; null while they are being generated. */
  fileCount: number | null;
  method: InstallMethod;
  onMethod: (m: InstallMethod) => void;
  /** True while the install request is pending. */
  disabled: boolean;
  error: InstallError | null;
}) {
  const t = useTranslations("ci");
  const count = fileCount ?? 0;
  const options: { value: InstallMethod; title: string; body: string }[] = [
    mode === "update"
      ? { value: "pr", title: t("exportWizard.updatePrTitle"), body: t("exportWizard.updatePrBody", { repo, count }) }
      : { value: "pr", title: t("exportWizard.installPrTitle"), body: t("exportWizard.installCardBody", { repo, count }) },
    { value: "zip", title: t("exportWizard.zipTitle"), body: t("exportWizard.zipBody", { repo, count }) },
  ];

  return (
    <div style={s.wrap}>
      {fileCount === null && <div style={s.note}>{t("exportWizard.waitingForFiles")}</div>}
      <div role="radiogroup" aria-label={t("exportWizard.steps.install")} style={s.wrap}>
        {options.map((o) => (
          <label key={o.value} style={s.option(method === o.value)}>
            <input
              type="radio"
              name="ci-install-method"
              value={o.value}
              checked={method === o.value}
              disabled={disabled}
              onChange={() => onMethod(o.value)}
              aria-label={o.title}
            />
            <span style={s.optionText}>
              <span style={s.optionTitle}>{o.title}</span>
              <span style={s.optionBody}>{o.body}</span>
            </span>
          </label>
        ))}
      </div>

      {error && (
        <div style={s.error} role="alert">
          <strong>{t("exportWizard.installFailed")}</strong>
          {error.code && t.has(`exportWizard.errorHint.${error.code}`) && (
            <span>{t(`exportWizard.errorHint.${error.code}`)}</span>
          )}
          <span style={s.errorDetail}>{error.message}</span>
        </div>
      )}

      <a href={SECRETS_HELP_URL} target="_blank" rel="noopener noreferrer" style={s.help}>
        {t("exportWizard.needHelp")}
      </a>
    </div>
  );
}
