/* RunReviewDropdown — the PR page's "Run Review" agent picker (L07,
   specs/multi-agent-review.md AC-MAR-21..26). A popover with one checkbox per
   workspace agent (enabled ones pre-checked, at most MAX_AGENTS_PER_RUN), Clear,
   "Run multi-agent review (N)" and "Configure agents…". Starting runs
   POST /pulls/:id/review { agentIds } and opens the PR's Results page; one
   checked agent is a single-agent review. A failed start keeps the selection
   (the global mutation handler shows the toast). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useStartMultiAgentRun } from "../../../../../../../lib/hooks/multi-agent";
import {
  MAX_AGENTS_PER_RUN,
  configureRunHref,
  multiAgentResultsHref,
} from "../../../../../../../lib/multi-agent";
import { initialSelection, isAtLimit, pruneSelection, toggleSelection } from "./helpers";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  repoId,
  prNumber,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  repoId: string;
  prNumber: number;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("multiAgent");
  const tr = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const start = useStartMultiAgentRun();
  const all = React.useMemo(() => agents ?? [], [agents]);

  const [open, setOpen] = React.useState(false);
  // null until the agent list arrives; then enabled agents are pre-checked once.
  const [selected, setSelected] = React.useState<string[] | null>(null);
  React.useEffect(() => {
    if (!agents) return;
    setSelected((prev) => (prev === null ? initialSelection(agents) : pruneSelection(prev, agents)));
  }, [agents]);
  const picked = selected ?? [];
  const atLimit = isAtLimit(picked);

  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async () => {
    if (picked.length === 0 || start.isPending) return;
    onRunStart?.();
    try {
      const res = await start.mutateAsync({ prId, agentIds: picked });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      setOpen(false);
      router.push(multiAgentResultsHref(repoId, prNumber));
    } catch {
      // Toasted by the global MutationCache handler; the selection is kept (AC-MAR-26).
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={ref} style={s.root}>
      <span
        title={warnMerged ? tr("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button
          kind={kind}
          size={size}
          iconRight="ChevronDown"
          icon="Sparkles"
          loading={start.isPending}
          onClick={() => setOpen((o) => !o)}
        >
          {start.isPending ? tr("runReview.running") : tr("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div role="dialog" aria-label={t("picker.heading")} style={s.panel}>
          {warnMerged && (
            <div style={s.warning}>
              <Icon.AlertTriangle size={13} />
              {tr("runReview.mergedWarning")}
            </div>
          )}
          <div style={s.header}>
            <span style={s.heading}>{t("picker.heading")}</span>
            {all.length > 0 && (
              <button type="button" style={s.clear} onClick={() => setSelected([])}>
                {t("picker.clear")}
              </button>
            )}
          </div>

          {all.length === 0 ? (
            <div style={s.empty}>
              <span>{t("picker.noAgents")}</span>
              <button type="button" style={s.link} onClick={() => router.push("/agents")}>
                {t("configure.goToAgents")}
              </button>
            </div>
          ) : (
            <div style={s.list}>
              {all.map((a) => {
                const checked = picked.includes(a.id);
                const blocked = !checked && atLimit;
                return (
                  <div key={a.id} style={blocked ? s.rowMuted : s.row} data-testid={`pick-${a.id}`}>
                    <Checkbox
                      checked={checked}
                      onChange={blocked ? undefined : () => setSelected((prev) => toggleSelection(prev ?? [], a.id))}
                      label={
                        <span style={s.agentLabel}>
                          <span style={s.agentName}>{a.name}</span>
                          <span style={s.agentHint}>
                            {a.enabled ? a.model : `${a.model} · ${t("picker.disabled")}`}
                          </span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
          {atLimit && <div style={s.note}>{t("picker.limit", { max: MAX_AGENTS_PER_RUN })}</div>}

          <Button kind="primary" size="sm" disabled={picked.length === 0} loading={start.isPending} onClick={run}>
            {t("picker.run", { count: picked.length })}
          </Button>
          <div style={s.divider} />
          <button type="button" style={s.link} onClick={() => router.push(configureRunHref(repoId, prId))}>
            {t("picker.configure")}
          </button>
        </div>
      )}
    </div>
  );
}
