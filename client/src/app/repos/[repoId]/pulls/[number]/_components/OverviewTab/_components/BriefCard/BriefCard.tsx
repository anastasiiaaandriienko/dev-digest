"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Button, IconBtn, MonoLink, SectionLabel } from "@devdigest/ui";
import type { PrBriefState } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { briefKey, usePrBrief, useRunBrief } from "@/lib/hooks/brief";
import { usePullSettled } from "@/lib/hooks/intent";
import { RISK_COLORS, STALE_COLORS } from "./constants";
import { focusHref } from "./helpers";
import { s } from "./styles";

interface BriefCardProps {
  prId: string | null;
}

type T = ReturnType<typeof useTranslations<"brief">>;

/**
 * PR Brief card: summary, risks and "Review focus" for the Overview tab.
 * Everything is rendered as PLAIN TEXT (LLM output is untrusted). The only POST is
 * an explicit Generate / Refresh click — never on mount. Tokens, attempts and cost
 * from `meta` are deliberately never rendered.
 */
export function BriefCard({ prId }: BriefCardProps) {
  const t = useTranslations("brief");
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const detailSettled = usePullSettled(prId, briefKey);
  const { data, isLoading, isError, refetch } = usePrBrief(prId, detailSettled);
  const run = useRunBrief(prId);
  const inflight = React.useRef(false);

  const onRun = (force: boolean) => {
    if (inflight.current || run.isPending) return;
    inflight.current = true;
    run.mutate(
      { force },
      {
        onSettled: () => {
          inflight.current = false;
        },
      },
    );
  };

  const runError = run.isError
    ? run.error instanceof ApiError
      ? run.error.message
      : t("card.errors.fallback")
    : null;

  let body: React.ReactNode;
  if (isLoading || (!data && !isError)) {
    body = (
      <p role="status" style={s.muted}>
        {t("card.loading")}
      </p>
    );
  } else if (isError || !data) {
    body = (
      <div role="alert" style={s.error}>
        <span>{t("card.loadError")}</span>
        <Button size="sm" kind="ghost" onClick={() => void refetch()}>
          {t("card.retry")}
        </Button>
      </div>
    );
  } else {
    // model_error only blocks NEW runs; a stored brief and its focus items stay visible.
    const canRun = !data.model_error && detailSettled && !run.isPending;
    body = (
      <>
        {data.brief ? (
          <BriefBody
            state={data}
            t={t}
            refreshDisabled={!canRun}
            onRefresh={() => onRun(true)}
            onFocus={(item) => router.push(focusHref(pathname, item))}
          />
        ) : (
          <>
            <p style={s.muted}>{t("card.empty")}</p>
            <div style={s.actions}>
              <Button kind="primary" icon="Sparkles" loading={run.isPending} disabled={!canRun} onClick={() => onRun(false)}>
                {run.isPending ? t("card.generating") : t("card.generate")}
              </Button>
              <span style={s.notice}>{detailSettled ? t("card.callNotice") : t("card.waitingForPr")}</span>
            </div>
          </>
        )}

        {data.model_error && (
          <div role="alert" style={s.modelError}>
            <div>{data.model_error}</div>
            <div>
              {t("card.modelErrorHint")}{" "}
              <Link href="/settings/models" style={s.link}>
                {t("card.settingsLink")}
              </Link>
            </div>
          </div>
        )}

        {runError && (
          <div role="alert" style={s.error}>
            <span>{runError}</span>
          </div>
        )}
      </>
    );
  }

  return (
    <section style={{ minWidth: 0 }}>
      <SectionLabel icon="FileText" right={data?.brief ? <StaleIndicator state={data} t={t} /> : undefined}>
        {t("card.title")}
      </SectionLabel>
      <div style={s.card}>{body}</div>
    </section>
  );
}

function StaleIndicator({ state, t }: { state: PrBriefState; t: T }) {
  if (state.freshness !== "stale") return null;
  return (
    <span style={s.reasons}>
      <Badge color={STALE_COLORS.color} bg={STALE_COLORS.bg} dot>
        {t("card.stale")}
      </Badge>
      {state.stale_reasons.map((r) => (
        <Badge key={r} color={STALE_COLORS.color} bg={STALE_COLORS.bg}>
          {t(`card.staleReasons.${r}`)}
        </Badge>
      ))}
    </span>
  );
}

interface BriefBodyProps {
  state: PrBriefState;
  t: T;
  refreshDisabled: boolean;
  onRefresh: () => void;
  onFocus: (item: { path: string; line: number }) => void;
}

function BriefBody({ state, t, refreshDisabled, onRefresh, onFocus }: BriefBodyProps) {
  const brief = state.brief!;
  const focus = brief.review_focus ?? [];
  const risks = brief.risks.risks;
  return (
    <>
      <div style={s.top}>
        {brief.summary ? <p style={s.summary}>{brief.summary}</p> : <div style={s.spacer} />}
        <IconBtn icon="RefreshCw" label={t("card.refresh")} disabled={refreshDisabled} onClick={onRefresh} />
      </div>

      {focus.length > 0 && (
        <div>
          <div style={s.groupTitle}>
            <span>{t("card.reviewFocus", { count: focus.length })}</span>
            <span style={s.groupHint}>{t("card.reviewFocusHint")}</span>
          </div>
          <ul style={s.list}>
            {focus.map((item, i) => (
              <li key={`${item.path}:${item.line}:${i}`} style={s.focusItem}>
                <MonoLink onClick={() => onFocus(item)}>{`${item.path}:${item.line}`}</MonoLink>
                <span>{` — ${item.reason}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div style={s.groupTitle}>{t("card.risks")}</div>
        {risks.length === 0 ? (
          <p style={s.muted}>{t("noRisks")}</p>
        ) : (
          <ul style={s.list}>
            {risks.map((r, i) => {
              const c = RISK_COLORS[r.severity];
              return (
                <li key={i} style={s.risk}>
                  <div style={s.riskHead}>
                    <Badge color={c.color} bg={c.bg}>
                      {t(`card.severity.${r.severity}`)}
                    </Badge>
                    <span style={s.riskTitle}>{r.title}</span>
                  </div>
                  <p style={s.riskText}>{r.explanation}</p>
                  {r.file_refs.length > 0 && (
                    <div style={s.refs}>
                      {r.file_refs.map((ref) => (
                        <span key={ref} className="mono">
                          {ref}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
