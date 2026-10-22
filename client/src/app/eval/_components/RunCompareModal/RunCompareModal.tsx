/* RunCompareModal — two finished runs of one agent (spec §12.4; design
   screen_skills.jsx `RunCompare`): metrics old → new with deltas (N/A-safe),
   warnings (different case sets, same prompt, config changes), the config and
   skill changes, the word-level system-prompt diff and per-case flips. All data
   comes from GET /eval-runs/compare — nothing is recomputed here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Modal, SectionLabel, Skeleton } from "@devdigest/ui";
import type { EvalCaseChange, EvalConfigSummary, EvalRunComparison } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useEvalCompare } from "@/lib/hooks/evals";
import { fmtCost, fmtDeltaPt, fmtPct } from "@/lib/evals";
import { diffTokens, PROMPT_DIFF_MAX_TOKENS } from "./helpers";
import { s } from "./styles";

const CHANGE_STYLE: Record<EvalCaseChange, { color: string; bg: string }> = {
  fixed: { color: "var(--ok)", bg: "var(--ok-bg)" },
  regressed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  unchanged: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
  only_base: { color: "var(--warn)", bg: "var(--warn-bg)" },
  only_head: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

export function RunCompareModal({
  baseId,
  headId,
  baseVersion,
  headVersion,
  onClose,
}: {
  baseId: string;
  headId: string;
  baseVersion: number;
  headVersion: number;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const q = useEvalCompare(baseId, headId);
  return (
    <Modal
      width={980}
      title={t("compare.title", { base: baseVersion, head: headVersion })}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("compare.close")}
          </Button>
        </div>
      }
    >
      <div style={s.body} data-testid="run-compare">
        {q.isLoading ? (
          <Skeleton height={220} />
        ) : q.isError ? (
          <ErrorState
            title={t("compare.loadError")}
            body={compareErrorText(q.error, t)}
            onRetry={() => void q.refetch()}
          />
        ) : q.data ? (
          <CompareBody cmp={q.data} />
        ) : null}
      </div>
    </Modal>
  );
}

function compareErrorText(err: unknown, t: ReturnType<typeof useTranslations<"eval">>): string {
  if (err instanceof ApiError && (err.code === "different_agents" || err.code === "run_not_done")) {
    return t(`compare.errors.${err.code}`);
  }
  return err instanceof Error ? err.message : "";
}

function CompareBody({ cmp }: { cmp: EvalRunComparison }) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  const metrics = [
    { key: "recall", label: t("evalsTab.metric.recall"), base: cmp.base.recall, head: cmp.head.recall, d: cmp.delta.recall, color: "var(--accent)" },
    { key: "precision", label: t("evalsTab.metric.precision"), base: cmp.base.precision, head: cmp.head.precision, d: cmp.delta.precision, color: "var(--ok)" },
    {
      key: "citation",
      label: t("evalsTab.metric.citation"),
      base: cmp.base.citation_accuracy,
      head: cmp.head.citation_accuracy,
      d: cmp.delta.citation_accuracy,
      color: "var(--warn)",
    },
  ] as const;
  const diff = React.useMemo(() => diffTokens(cmp.base_prompt, cmp.head_prompt), [cmp.base_prompt, cmp.head_prompt]);

  return (
    <>
      <div style={s.metrics}>
        {metrics.map((m) => {
          const delta = fmtDeltaPt(m.d);
          return (
            <div key={m.key} style={s.metric} data-testid={`compare-metric-${m.key}`}>
              <div style={s.metricLabel}>{m.label}</div>
              <div style={s.metricRow}>
                <span className="tnum" style={s.old}>{fmtPct(m.base, na)}</span>
                <Icon.ArrowRight size={13} style={{ color: "var(--text-muted)" }} />
                <span className="tnum" style={s.new(m.head == null ? "var(--text-muted)" : m.color)}>{fmtPct(m.head, na)}</span>
                {delta && delta !== "±0pt" && (
                  <span className="tnum" style={s.delta(m.d! >= 0)}>
                    {delta}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div style={s.metric} data-testid="compare-metric-cost">
          <div style={s.metricLabel}>{t("compare.cost")}</div>
          <div style={s.metricRow}>
            <span className="tnum" style={s.old}>{fmtCost(cmp.base.cost_usd, na)}</span>
            <Icon.ArrowRight size={13} style={{ color: "var(--text-muted)" }} />
            <span className="tnum" style={s.new("var(--text-primary)")}>{fmtCost(cmp.head.cost_usd, na)}</span>
          </div>
        </div>
      </div>

      {!cmp.same_case_set && (
        <div role="alert" style={s.warn} data-testid="compare-different-cases">
          <Icon.AlertTriangle size={15} style={{ color: "var(--warn)", flexShrink: 0 }} />
          {t("compare.differentCases")}
        </div>
      )}
      {!cmp.prompt_changed && (
        <div role="note" style={s.note} data-testid="compare-same-prompt">
          {t("compare.samePrompt")}
        </div>
      )}
      {cmp.config_changes.length > 0 && (
        <div role="note" style={s.note} data-testid="compare-config-changes">
          {t("compare.configChanges", { list: cmp.config_changes.join(", ") })}
        </div>
      )}

      <SectionLabel icon="Settings">{t("compare.configHeading")}</SectionLabel>
      <div style={s.configGrid} data-testid="compare-config">
        <div />
        <div style={s.configHead}>{t("compare.base", { version: cmp.base.agent_version })}</div>
        <div style={s.configHead}>{t("compare.head", { version: cmp.head.agent_version })}</div>
        {(
          [
            ["provider", t("runDetail.provider")],
            ["model", t("runDetail.model")],
            ["strategy", t("runDetail.strategy")],
            ["prompt_sha", t("compare.promptSha")],
          ] as const
        ).map(([key, label]) => (
          <ConfigRow key={key} label={label} base={summaryValue(cmp.config.base, key)} head={summaryValue(cmp.config.head, key)} na={na} />
        ))}
        <ConfigRow
          label={t("runDetail.skills")}
          base={skillsLabel(cmp.config.base, t("runDetail.noSkills"))}
          head={skillsLabel(cmp.config.head, t("runDetail.noSkills"))}
          na={na}
        />
      </div>
      {cmp.skill_changes.length > 0 && (
        <div style={s.skillChanges} data-testid="compare-skill-changes">
          <span style={s.smallLabel}>{t("compare.skillChanges")}:</span>
          {cmp.skill_changes.map((c) => (
            <Badge key={c.id} color="var(--text-secondary)">
              {`${c.name} — ${t(`compare.skillChange.${c.change}`)}${
                c.change === "changed" ? ` (v${c.base_version} → v${c.head_version})` : ""
              }`}
            </Badge>
          ))}
        </div>
      )}

      <SectionLabel icon="FileText">{t("compare.promptDiff")}</SectionLabel>
      {diff.truncated && (
        <div role="note" style={s.note}>
          {t("compare.promptTruncated", { words: PROMPT_DIFF_MAX_TOKENS })}
        </div>
      )}
      <div className="mono" style={s.diff} data-testid="compare-prompt-diff">
        {diff.tokens.map((tk, i) => (
          <span key={i} data-k={tk.k} style={s.token(tk.k)}>
            {tk.t}
          </span>
        ))}
      </div>

      <SectionLabel icon="ListChecks">{t("compare.cases")}</SectionLabel>
      <div style={s.cases} data-testid="compare-cases">
        {cmp.cases.map((c) => (
          <div key={c.case_id} style={s.caseRow} data-testid="compare-case" data-change={c.change}>
            <span className="mono" style={s.caseName}>
              {c.case_name}
            </span>
            <span style={s.kind}>{t(`evalsTab.kind.${c.kind}`)}</span>
            <span className="mono" style={s.outcomes}>
              {(c.base ? t(`evalsTab.outcome.${c.base}`) : t("compare.missing")) +
                " → " +
                (c.head ? t(`evalsTab.outcome.${c.head}`) : t("compare.missing"))}
            </span>
            <Badge color={CHANGE_STYLE[c.change].color} bg={CHANGE_STYLE[c.change].bg}>
              {t(`compare.change.${c.change}`)}
            </Badge>
          </div>
        ))}
      </div>
    </>
  );
}

function summaryValue(c: EvalConfigSummary | null, key: "provider" | "model" | "strategy" | "prompt_sha"): string | null {
  if (!c) return null;
  return key === "prompt_sha" ? `${c.prompt_sha.slice(0, 12)}…` : c[key];
}

function skillsLabel(c: EvalConfigSummary | null, none: string): string | null {
  if (!c) return null;
  return c.skills.length === 0 ? none : c.skills.map((k) => `${k.name} v${k.version}`).join(", ");
}

function ConfigRow({ label, base, head, na }: { label: string; base: string | null; head: string | null; na: string }) {
  const changed = base !== head;
  return (
    <>
      <div style={s.configLabel}>{label}</div>
      <div className="mono" style={s.configValue(false)}>
        {base ?? na}
      </div>
      <div className="mono" style={s.configValue(changed)} data-changed={changed || undefined}>
        {head ?? na}
      </div>
    </>
  );
}
