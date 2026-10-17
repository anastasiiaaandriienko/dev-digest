"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, MonoLink, SectionLabel, type IconName } from "@devdigest/ui";
import type { BlastRadius, DownstreamImpact } from "@devdigest/shared";
import { blastKey, useBlastRadius } from "@/lib/hooks/blast";
import { usePullSettled } from "@/lib/hooks/intent";
import { githubCommitUrl } from "@/lib/github-urls";
import { CRON_COLORS, ENDPOINT_COLORS } from "./constants";
import {
  callerCount,
  declarationOf,
  impactId,
  initialExpanded,
  location,
  shortSha,
  symbolLabel,
  totalsOf,
} from "./helpers";
import { s } from "./styles";

interface BlastRadiusBlockProps {
  prId: string | null;
}

/**
 * HW-04 Blast Radius: changed symbols → direct callers (file:line, linked to the
 * INDEXED commit) → potentially affected endpoints / crons. GET-only; the read
 * waits for the PR detail to settle so it never races the pr_files resync.
 */
export function BlastRadiusBlock({ prId }: BlastRadiusBlockProps) {
  const t = useTranslations("blast");
  const detailSettled = usePullSettled(prId, blastKey);
  const { data, isLoading, isError, refetch } = useBlastRadius(prId, detailSettled);

  let body: React.ReactNode;
  if (isLoading || (!data && !isError)) {
    body = (
      <p role="status" style={s.muted}>
        {t("loading")}
      </p>
    );
  } else if (isError || !data) {
    body = (
      <div role="alert" style={s.error}>
        <span>{t("loadError")}</span>
        <Button size="sm" kind="ghost" onClick={() => void refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  } else {
    body = <BlastBody blast={data} t={t} />;
  }

  const sha = shortSha(data?.source?.ref);
  return (
    <section style={{ minWidth: 0 }}>
      <SectionLabel
        icon="Workflow"
        right={
          sha ? (
            <Badge mono icon="GitCommit">
              {sha}
            </Badge>
          ) : undefined
        }
      >
        {t("title")}
      </SectionLabel>
      <div style={s.card}>{body}</div>
    </section>
  );
}

type T = ReturnType<typeof useTranslations<"blast">>;

function BlastBody({ blast, t }: { blast: BlastRadius; t: T }) {
  const totals = totalsOf(blast);
  const reason = blast.degraded ? (blast.reason ?? "no_data") : null;

  if (reason === "no_files") return <Degraded reason={reason} t={t} />;

  return (
    <>
      {reason && <Degraded reason={reason} t={t} />}
      <p style={s.summary}>{blast.summary}</p>
      <div style={s.stats}>
        <Stat icon="Code" value={totals.symbols} label={t("stat.symbols", { count: totals.symbols })} />
        <Stat icon="CornerDownRight" value={totals.callers} label={t("stat.callers", { count: totals.callers })} />
        <Stat icon="Globe" value={totals.endpoints} label={t("stat.endpoints", { count: totals.endpoints })} />
        <Stat icon="Clock" value={totals.crons} label={t("stat.crons", { count: totals.crons })} />
      </div>
      {totals.symbols === 0 ? (
        <p style={s.muted}>{t("noSymbols")}</p>
      ) : (
        <>
          {totals.callers === 0 && <p style={s.muted}>{t("noCallersAll")}</p>}
          <Tree blast={blast} t={t} />
          <p style={s.hint}>{t("endpointsHint")}</p>
          <SourceNote blast={blast} t={t} />
        </>
      )}
    </>
  );
}

function Stat({ icon, value, label }: { icon: IconName; value: number; label: string }) {
  const I = Icon[icon];
  return (
    <span style={s.stat}>
      <I size={14} />
      <span style={s.statValue}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function Degraded({ reason, t }: { reason: NonNullable<BlastRadius["reason"]>; t: T }) {
  return (
    <div role="note" aria-label={t("degradedTitle")} style={s.degraded}>
      <Icon.AlertTriangle size={14} style={s.degradedIcon} />
      <span>
        <strong>{t("degradedTitle")}.</strong> {t(`reasons.${reason}`)}
      </span>
    </div>
  );
}

function SourceNote({ blast, t }: { blast: BlastRadius; t: T }) {
  const source = blast.source;
  const sha = shortSha(source?.ref);
  if (!source || !sha) return <p style={s.hint}>{t("sourceUnknown")}</p>;
  return (
    <p style={s.hint}>
      {t.rich("sourceNote", {
        ref: sha,
        sha: (chunks) => (
          <a
            className="mono"
            href={githubCommitUrl(source.repo_full_name, source.ref)}
            target="_blank"
            rel="noopener noreferrer"
            style={s.link}
          >
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}

function Tree({ blast, t }: { blast: BlastRadius; t: T }) {
  const [expanded, setExpanded] = React.useState(() => initialExpanded(blast));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul style={s.tree}>
      {blast.downstream.map((impact, i) => {
        const id = impactId(impact, i);
        return (
          <SymbolNode
            key={id}
            id={id}
            blast={blast}
            impact={impact}
            open={expanded.has(id)}
            onToggle={() => toggle(id)}
            t={t}
          />
        );
      })}
    </ul>
  );
}

function SymbolNode({
  id,
  blast,
  impact,
  open,
  onToggle,
  t,
}: {
  id: string;
  blast: BlastRadius;
  impact: DownstreamImpact;
  open: boolean;
  onToggle: () => void;
  t: T;
}) {
  const decl = declarationOf(blast, impact);
  const count = callerCount(impact);
  const panelId = `blast-panel-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  return (
    <li style={s.node}>
      <div style={s.nodeHeader}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t("toggle", { name: impact.symbol })}
          onClick={onToggle}
          style={s.toggle}
        >
          <Chevron size={14} />
          <Icon.Code size={14} style={s.codeIcon} />
          <span className="mono">{symbolLabel(impact.symbol, decl?.kind)}</span>
        </button>
        <span style={s.callerCount}>{t("callerCount", { count })}</span>
      </div>
      {open && (
        <div id={panelId} style={s.panel}>
          {decl && <SourceLink file={decl.file} line={decl.line} url={decl.url} />}
          {impact.callers.length === 0 ? (
            <p style={s.muted}>{t("noCallers")}</p>
          ) : (
            <ul style={s.callers}>
              {impact.callers.map((c, i) => (
                <li key={`${c.file}:${c.line}:${i}`} style={s.caller}>
                  <Icon.CornerDownRight size={13} style={s.callerIcon} />
                  <span style={s.callerPath}>
                    <SourceLink file={c.file} line={c.line} url={c.url} />
                  </span>
                  <span style={s.callerName}>{c.name}</span>
                </li>
              ))}
            </ul>
          )}
          {impact.truncated && (
            <p style={s.hint}>{t("truncated", { shown: impact.callers.length, total: count })}</p>
          )}
          {impact.endpoints_affected.length > 0 && (
            <div>
              <div style={s.groupTitle}>{t("potentialEndpoints")}</div>
              <div style={s.chips}>
                {impact.endpoints_affected.map((e) => (
                  <Badge key={e} mono icon="Globe" color={ENDPOINT_COLORS.color} bg={ENDPOINT_COLORS.bg}>
                    {e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {impact.crons_affected.length > 0 && (
            <div>
              <div style={s.groupTitle}>{t("crons")}</div>
              <div style={s.chips}>
                {impact.crons_affected.map((c) => (
                  <Badge key={c} mono icon="Clock" color={CRON_COLORS.color} bg={CRON_COLORS.bg}>
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** `file:line` as a GitHub link when the server sent one (pinned to the indexed commit). */
function SourceLink({ file, line, url }: { file: string; line?: number; url?: string | null }) {
  const label = location(file, line);
  return url ? <MonoLink href={url}>{label}</MonoLink> : <span className="mono">{label}</span>;
}
