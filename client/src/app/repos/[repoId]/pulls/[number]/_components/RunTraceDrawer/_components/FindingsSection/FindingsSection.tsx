/* FindingsSection — the persisted findings of THIS run (same data as the
   "Review runs" list), rendered inside a collapsible TraceSection: read-only
   severity counts, each finding with its accepted / dismissed state, and the
   findings the grounding gate dropped (parsed from the run log). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { countBySeverity, findingLocation, type SeverityKey } from "@/lib/findings";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { SeverityChips } from "../../../SeverityChips";
import { visibleFindings } from "../../../FindingsPanel/helpers";
import type { DroppedFinding } from "../../helpers";

function sevToken(severity: string) {
  return SEV[(severity in SEV ? severity : "INFO") as SeverityKey];
}

export function FindingsSection({
  findings,
  dropped = [],
}: {
  findings: FindingRecord[];
  /** Findings removed by the grounding gate (title + reason from the log). */
  dropped?: DroppedFinding[];
}) {
  const t = useTranslations("runs");
  const [showDropped, setShowDropped] = React.useState(false);
  const sorted = React.useMemo(() => visibleFindings(findings, { hideLow: false }), [findings]);
  return (
    <TraceSection
      icon="AlertOctagon"
      title={t("trace.findings")}
      right={<Badge color="var(--text-muted)">{findings.length}</Badge>}
    >
      {findings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <SeverityChips counts={countBySeverity(findings)} />
        </div>
      )}
      {findings.length === 0 ? (
        <span style={s.noToolCalls}>{t("trace.noFindings")}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((f) => {
            const sev = sevToken(f.severity);
            const state = f.accepted_at ? "accepted" : f.dismissed_at ? "dismissed" : null;
            return (
              <div
                key={f.id}
                data-finding-id={f.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: "var(--bg-surface)",
                  opacity: state === "dismissed" ? 0.65 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Badge color={sev.c} bg={sev.bg} icon={sev.icon}>
                    {f.severity}
                  </Badge>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}>{f.title}</span>
                  {state && (
                    <Badge
                      color={state === "accepted" ? "var(--ok)" : "var(--text-muted)"}
                      bg={state === "accepted" ? "var(--ok-bg)" : "var(--bg-hover)"}
                      icon={state === "accepted" ? "Check" : "X"}
                    >
                      {t(`trace.findingState.${state}`)}
                    </Badge>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>
                  {findingLocation(f)}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {f.rationale}
                </div>
                {f.suggestion && (
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 6 }}>
                    <strong>{t("trace.suggestedFix")} </strong>
                    {f.suggestion}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dropped.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            aria-expanded={showDropped}
            onClick={() => setShowDropped((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--warn)",
              cursor: "pointer",
            }}
          >
            <Icon.ChevronDown
              size={13}
              style={{ transform: showDropped ? "none" : "rotate(-90deg)", transition: "transform .15s" }}
            />
            {t("trace.dropped.title", { count: dropped.length })}
          </button>
          {showDropped && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t("trace.dropped.hint")}</span>
              {dropped.map((d, i) => (
                <div
                  key={i}
                  data-testid="dropped-finding"
                  style={{
                    border: "1px dashed var(--border)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{d.title}</div>
                  <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{d.reason}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TraceSection>
  );
}
