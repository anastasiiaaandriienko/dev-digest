/* CiTab — AgentEditor → CI (L07, specs/export-to-ci.md §6.3 "Agent CI tab", AC-CI-49,
   57, 60..67): "CI deployment" with the "Active in N repos" badge, one row per
   installation (pending / active / error), "+ Add to CI" / "+ Add repository" /
   "Update CI config" opening the export wizard, and "Fail CI on" saved through the
   existing agent update. Mounted only while active; opening it starts the silent
   automatic sync (the server skips installations synced in the last 10 minutes).
   The wizard itself (B11–B12) is plugged in through `renderWizard`: until then the
   buttons that open it are disabled with a note. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, Skeleton, SelectInput } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useCiAutoSync, useCiInstallations, useCiSync } from "@/lib/hooks/ci";
import { notify } from "@/lib/toast";
import type { UnsavedGuard } from "@/lib/unsaved-guard";
import { CI_FAIL_ON_VALUES } from "../ConfigTab/constants";
import { InstallationRow } from "./_components/InstallationRow";
import { activeCount, type CiWizardRequest, type RenderCiWizard } from "./helpers";
import { s } from "./styles";

export function CiTab({
  agent,
  guardRef,
  renderWizard,
}: {
  agent: Agent;
  /** The Config tab's unsaved-edits guard: saving "Fail CI on" bumps the agent version. */
  guardRef?: React.MutableRefObject<UnsavedGuard | null>;
  /** The export wizard (B11–B12). Without it, the buttons that open it are disabled. */
  renderWizard?: RenderCiWizard;
}) {
  const t = useTranslations("ci");
  const ta = useTranslations("agents");
  const installationsQ = useCiInstallations(agent.id);
  useCiAutoSync();
  const sync = useCiSync();
  const update = useUpdateAgent();
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [wizard, setWizard] = React.useState<CiWizardRequest | null>(null);

  const installations = installationsQ.data ?? [];
  const active = activeCount(installations);
  const wizardDisabled = renderWizard ? undefined : t("ciTab.wizardSoon");
  const open = (request: CiWizardRequest) => {
    if (renderWizard) setWizard(request);
  };

  const syncOne = (installationId: string) => {
    setSyncingId(installationId);
    sync.mutate(
      { mode: "manual", installation_id: installationId },
      {
        onSuccess: (res) => {
          if (res.errors.length > 0) notify.error(res.errors[0]!.message);
          else if (res.throttled > 0) notify.info(t("ciTab.throttled"));
          else notify.success(t("ciTab.synced", { count: res.ingested }));
        },
        onSettled: () => setSyncingId(null),
      },
    );
  };

  const saveFailOn = (value: string) => {
    if (value === agent.ci_fail_on) return;
    if (guardRef?.current?.dirty) {
      notify.info(t("ciTab.failOn.unsavedConfig"));
      return;
    }
    update.mutate(
      { id: agent.id, patch: { ci_fail_on: value as CiFailOn } },
      { onSuccess: () => notify.success(t("ciTab.failOn.saved")) },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.titleBlock}>
          <div style={s.titleRow}>
            <h2 style={s.title}>{t("ciTab.heading")}</h2>
            {active > 0 && (
              <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                {t("ciTab.activeIn", { count: active })}
              </Badge>
            )}
          </div>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <div style={s.headActions}>
          <Button kind="primary" icon="Plus" onClick={() => open({ mode: "add" })} disabled={!!wizardDisabled} title={wizardDisabled}>
            {t("ciTab.addToCi")}
          </Button>
        </div>
      </div>

      {installationsQ.isLoading ? (
        <Skeleton height={64} />
      ) : installationsQ.isError ? (
        <ErrorState
          title={t("ciTab.loadError")}
          body={(installationsQ.error as Error)?.message}
          onRetry={() => void installationsQ.refetch()}
        />
      ) : installations.length === 0 ? (
        <EmptyState
          icon="GitBranch"
          title={t("ciTab.empty.title")}
          body={t("ciTab.empty.body")}
          cta={wizardDisabled ? undefined : t("ciTab.addToCi")}
          onCta={wizardDisabled ? undefined : () => open({ mode: "add" })}
        />
      ) : (
        <>
          <div style={s.list}>
            {installations.map((i) => (
              <InstallationRow
                key={i.id}
                installation={i}
                agentId={agent.id}
                agentVersion={agent.version}
                syncing={syncingId === i.id}
                onSync={() => syncOne(i.id)}
                onUpdate={() => open({ mode: "update", repo: i.repo, target: i.target_type })}
                updateDisabledReason={wizardDisabled}
              />
            ))}
          </div>
          <div style={s.addRepo}>
            <Button kind="ghost" icon="Plus" onClick={() => open({ mode: "add" })} disabled={!!wizardDisabled} title={wizardDisabled}>
              {t("ciTab.addRepository")}
            </Button>
          </div>
        </>
      )}

      <div style={s.failOn}>
        <label style={s.failOnLabel}>{t("ciTab.failOn.label")}</label>
        <SelectInput
          aria-label={t("ciTab.failOn.label")}
          value={agent.ci_fail_on}
          onChange={saveFailOn}
          options={CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: ta(`config.ciFailOnOptions.${v}`) }))}
        />
        <span style={s.hint}>{t("ciTab.failOn.hint")}</span>
      </div>

      {wizard && renderWizard?.(wizard, () => setWizard(null))}
    </div>
  );
}
