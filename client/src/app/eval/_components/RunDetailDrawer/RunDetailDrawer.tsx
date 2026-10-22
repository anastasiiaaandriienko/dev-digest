/* RunDetailDrawer — one eval run (`/eval?agent=<id>&run=<runId>`, spec §12.3):
   status and error, metrics (N/A when undefined), TP / FN / FP and FP reasons,
   the false positives, tokens / cost / duration, the frozen config snapshot and
   every case result. Read-only view of GET /eval-runs/:id (polls while running). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import type { AgentEvalRunDetail } from "@devdigest/shared";
import { useEvalRun } from "@/lib/hooks/evals";
import { expectedLocation, fmtCost, fmtPct } from "@/lib/evals";
import { findingLocation, uniqueDroppedCount, uniqueFalsePositives } from "./helpers";
import { s } from "./styles";

const STATUS_COLOR = { running: "var(--accent-text)", done: "var(--ok)", failed: "var(--crit)" } as const;

export function RunDetailDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const q = useEvalRun(runId);
  const run = q.data;
  return (
    <Drawer
      width={760}
      title={run ? t("runDetail.title", { version: run.agent_version }) : t("runDetail.title", { version: "…" })}
      subtitle={
        run
          ? t("runDetail.subtitle", { status: t(`evalsTab.history.status.${run.status}`), date: new Date(run.started_at).toLocaleString() })
          : undefined
      }
      onClose={onClose}
      footer={
        <Button kind="ghost" onClick={onClose}>
          {t("runDetail.close")}
        </Button>
      }
    >
      <div style={s.body} data-testid="run-detail">
        {q.isLoading ? (
          <Skeleton height={240} />
        ) : q.isError ? (
          <ErrorState title={t("runDetail.loadError")} body={(q.error as Error)?.message} onRetry={() => void q.refetch()} />
        ) : run ? (
          <DetailBody run={run} />
        ) : null}
      </div>
    </Drawer>
  );
}

function DetailBody({ run }: { run: AgentEvalRunDetail }) {
  const t = useTranslations("eval");
  const na = t("evalsTab.na");
  const counts = run.counts;
  const fps = uniqueFalsePositives(run.results);
  const dropped = uniqueDroppedCount(run.results);
  return (
    <>
      <div style={s.statusRow}>
        <Badge color={STATUS_COLOR[run.status]}>{t(`evalsTab.history.status.${run.status}`)}</Badge>
        {run.error && (
          <span role="alert" style={s.error} data-testid="run-detail-error">
            {t("runDetail.error", { error: run.error })}
          </span>
        )}
      </div>

      <SectionLabel icon="Gauge">{t("runDetail.metrics")}</SectionLabel>
      <div style={s.tiles}>
        {(
          [
            ["recall", t("evalsTab.metric.recall"), run.recall],
            ["precision", t("evalsTab.metric.precision"), run.precision],
            ["citation", t("evalsTab.metric.citation"), run.citation_accuracy],
          ] as const
        ).map(([k, label, v]) => (
          <div key={k} style={s.tile} data-testid={`run-detail-${k}`}>
            <div style={s.tileLabel}>{label}</div>
            <div className="tnum" style={s.tileValue(v == null)}>
              {fmtPct(v, na)}
            </div>
          </div>
        ))}
      </div>

      <SectionLabel icon="Hash">{t("runDetail.counts")}</SectionLabel>
      <div style={s.kv} data-testid="run-detail-counts">
        <KV label={t("runDetail.tp")} value={counts ? counts.tp : na} />
        <KV label={t("runDetail.fn")} value={counts ? counts.fn : na} />
        <KV label={t("runDetail.fp")} value={counts ? counts.fp : na} />
        <KV label={t("runDetail.kept")} value={counts ? counts.kept : na} />
        <KV label={t("runDetail.raw")} value={counts ? counts.raw : na} />
        <KV label={t("runDetail.validCitations")} value={counts ? counts.valid_citations : na} />
        <KV label={t("runDetail.tokens")} value={counts ? `${counts.tokens_in} / ${counts.tokens_out}` : na} />
        <KV label={t("runDetail.cost")} value={fmtCost(run.cost_usd, na)} />
        <KV
          label={t("runDetail.duration")}
          value={run.duration_ms == null ? na : t("runDetail.durationValue", { seconds: (run.duration_ms / 1000).toFixed(1) })}
        />
      </div>
      {counts && (
        <div style={s.reasons} data-testid="run-detail-fp-reasons">
          <span style={s.muted}>{t("runDetail.fpReasons")}:</span>
          {(["unlabeled", "negative_hit", "duplicate", "too_wide"] as const).map((r) => (
            <Badge key={r} color="var(--text-secondary)">{`${t(`runDetail.fpReason.${r}`)} ${counts.fp_by_reason[r]}`}</Badge>
          ))}
        </div>
      )}

      <SectionLabel icon="AlertTriangle">{t("runDetail.fpList")}</SectionLabel>
      {fps.length === 0 ? (
        <div style={s.muted}>{t("runDetail.fpListEmpty")}</div>
      ) : (
        <div style={s.list} data-testid="run-detail-fp-list">
          {fps.map(({ finding, reason }, i) => (
            <div key={i} style={s.listRow}>
              <span className="mono">{findingLocation(finding)}</span>
              <span style={s.listTitle}>{finding.title}</span>
              <Badge color="var(--text-secondary)">{t(`runDetail.fpReason.${reason}`)}</Badge>
            </div>
          ))}
        </div>
      )}
      {dropped > 0 && <div style={s.muted}>{t("runDetail.dropped", { count: dropped })}</div>}

      <SectionLabel icon="ListChecks">{t("runDetail.cases")}</SectionLabel>
      {run.results.length === 0 ? (
        <div style={s.muted}>{t("runDetail.casesEmpty")}</div>
      ) : (
        <div style={s.list} data-testid="run-detail-cases">
          {run.results.map((r) => (
            <div key={r.case_id} style={s.caseRow} data-testid="run-detail-case" data-outcome={r.outcome}>
              <span className="mono" style={s.caseName}>
                {r.case_name}
              </span>
              <span style={s.kind}>{t(`evalsTab.kind.${r.kind}`)}</span>
              <span className="mono" style={s.muted}>
                {expectedLocation(r)}
              </span>
              <span>
                <Badge color={r.pass ? "var(--ok)" : "var(--crit)"}>{t(`evalsTab.outcome.${r.outcome}`)}</Badge>
              </span>
              <span style={s.muted}>
                {r.error
                  ? r.error
                  : r.matched_finding
                    ? t("runDetail.matched", { location: findingLocation(r.matched_finding) })
                    : r.overlapping.length > 0
                      ? t("runDetail.overlapping", { count: r.overlapping.length })
                      : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {run.config && (
        <>
          <SectionLabel icon="Settings">{t("runDetail.config")}</SectionLabel>
          <div style={s.kv} data-testid="run-detail-config">
            <KV label={t("runDetail.provider")} value={run.config.provider} />
            <KV label={t("runDetail.model")} value={run.config.model} />
            <KV label={t("runDetail.strategy")} value={run.config.strategy} />
            <KV
              label={t("runDetail.skills")}
              value={run.config.skills.length === 0 ? t("runDetail.noSkills") : run.config.skills.map((k) => `${k.name} v${k.version}`).join(", ")}
            />
          </div>
          <div style={s.muted}>{t("runDetail.excluded", { list: run.config.excluded.join(", ") })}</div>
          <div style={s.promptLabel}>{t("runDetail.prompt")}</div>
          <pre className="mono" style={s.prompt}>
            {run.config.system_prompt}
          </pre>
        </>
      )}
    </>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={s.kvItem}>
      <div style={s.kvLabel}>{label}</div>
      <div className="mono tnum" style={s.kvValue}>
        {value}
      </div>
    </div>
  );
}
