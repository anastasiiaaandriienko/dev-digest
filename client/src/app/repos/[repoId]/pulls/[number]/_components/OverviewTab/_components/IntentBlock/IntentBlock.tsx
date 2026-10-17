"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SectionLabel } from "@devdigest/ui";
import type { PrIntentState } from "@devdigest/shared";
import {
  classifyIntentError,
  usePrIntent,
  usePullSettled,
  useRefreshIntentOnRunsSettled,
  useRunIntent,
} from "@/lib/hooks/intent";
import { formatCost } from "@/lib/format";
import { FRESHNESS_COLORS } from "./constants";
import { generatedTime, modelAvailable, modelLabel, shortSha, sourceKey } from "./helpers";
import { s } from "./styles";
import { ContextSources } from "./_components/ContextSources";

interface IntentBlockProps {
  prId: string | null;
}

/**
 * L03 Intent block. Everything here is rendered as PLAIN TEXT (LLM output is
 * untrusted): no Markdown, no HTML, no auto-linking. The only POST is an
 * explicit button click — never on mount.
 */
export function IntentBlock({ prId }: IntentBlockProps) {
  const t = useTranslations("intent");
  // Read only once the PR detail is settled (and re-read after each detail refetch),
  // so we don't report freshness from an intermediate pr_files resync.
  const detailSettled = usePullSettled(prId);
  const { data, isLoading, isError, refetch } = usePrIntent(prId, detailSettled);
  useRefreshIntentOnRunsSettled(prId); // GET-only re-read when a review run finishes
  const run = useRunIntent(prId);
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
  const onRefreshStatus = () => {
    run.reset();
    void refetch(); // GET only — never re-POSTs
  };

  const errorKind = run.isError ? classifyIntentError(run.error) : null;
  const running = run.isPending;

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
          {t("retryLoad")}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        {data.intent ? <IntentResult state={data} t={t} /> : <EmptyIntent state={data} t={t} />}
        {data.intent && <RecalcModel state={data} t={t} />}

        <div style={s.actions}>
          <Button
            kind={data.intent ? "secondary" : "primary"}
            icon={data.intent ? "RefreshCw" : "Sparkles"}
            loading={running}
            disabled={!modelAvailable(data.current_model) || !detailSettled}
            onClick={() => onRun(!!data.intent)}
          >
            {running ? t("running") : data.intent ? t("recalculate") : t("runIntent")}
          </Button>
          <span style={s.notice}>{detailSettled ? t("costNotice") : t("waitingForPr")}</span>
        </div>

        {errorKind && (
          <div role="alert" style={s.error}>
            <span>{t(`errors.${errorKind}`)}</span>
            {errorKind === "timeout" && (
              <Button size="sm" kind="ghost" onClick={onRefreshStatus}>
                {t("refreshStatus")}
              </Button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <section>
      <SectionLabel icon="Target" right={data ? <FreshnessBadge state={data} t={t} /> : undefined}>
        {t("title")}
      </SectionLabel>
      <div style={s.card}>{body}</div>
    </section>
  );
}

type T = ReturnType<typeof useTranslations<"intent">>;

function FreshnessBadge({ state, t }: { state: PrIntentState; t: T }) {
  // No intent yet → freshness is meaningless, keep the header clean.
  if (!state.intent) return null;
  const c = FRESHNESS_COLORS[state.freshness];
  return (
    <span style={s.reasons}>
      <Badge color={c.color} bg={c.bg} dot>
        {t(`freshness.${state.freshness}`)}
      </Badge>
      {state.freshness === "stale" &&
        state.stale_reasons.map((r) => (
          <Badge key={r} color={c.color} bg={c.bg}>
            {t(`staleReasons.${r}`)}
          </Badge>
        ))}
    </span>
  );
}

function ModelUnavailable({ state, t, recalc }: { state: PrIntentState; t: T; recalc?: boolean }) {
  return (
    <div role="alert" style={s.modelError}>
      <div>{state.model_error ?? t("modelErrorFallback")}</div>
      <div>
        {t("modelErrorHint")}{" "}
        <Link href="/settings/models" style={s.link}>
          {t("settingsLink")}
        </Link>
      </div>
      {recalc && <div>{t("recalcUnavailable")}</div>}
    </div>
  );
}

function EmptyIntent({ state, t }: { state: PrIntentState; t: T }) {
  const label = modelLabel(state.current_model);
  return (
    <>
      <p style={s.muted}>{t("emptyBody")}</p>
      {modelAvailable(state.current_model) && label ? (
        <div style={s.modelPreview}>
          {t("willUse", { model: label, source: t(sourceKey(state.current_model.source)) })}
        </div>
      ) : (
        <ModelUnavailable state={state} t={t} />
      )}
    </>
  );
}

/** Model the next Recalculate would use (may differ from the stored "Generated with"). */
function RecalcModel({ state, t }: { state: PrIntentState; t: T }) {
  const label = modelLabel(state.current_model);
  if (!modelAvailable(state.current_model) || !label) return <ModelUnavailable state={state} t={t} recalc />;
  return (
    <div style={s.modelPreview}>
      {t("recalcWillUse", { model: label, source: t(sourceKey(state.current_model.source)) })}
    </div>
  );
}

function ScopeList({ title, items, icon, t }: { title: string; items: string[]; icon: "Check" | "X"; t: T }) {
  const I = Icon[icon];
  return (
    <div>
      <div style={s.groupTitle}>{title}</div>
      {items.length === 0 ? (
        <p style={s.muted}>{t("none")}</p>
      ) : (
        <ul style={s.list}>
          {items.map((item, i) => (
            <li key={i} style={s.item}>
              <I size={14} style={icon === "Check" ? s.itemIconIn : s.itemIconOut} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IntentResult({ state, t }: { state: PrIntentState; t: T }) {
  const intent = state.intent!;
  const meta = state.meta;
  const risks = intent.risk_areas ?? [];
  const model = modelLabel(meta);
  const time = meta ? generatedTime(meta) : null;
  const sha = shortSha(meta?.head_sha);
  return (
    <>
      <p style={s.summary}>{intent.intent}</p>
      <div style={s.columns}>
        <ScopeList title={t("inScope")} items={intent.in_scope} icon="Check" t={t} />
        <ScopeList title={t("outOfScope")} items={intent.out_of_scope} icon="X" t={t} />
      </div>
      {risks.length > 0 && (
        <div>
          <div style={s.groupTitle}>{t("riskAreas")}</div>
          <div style={s.chips}>
            {risks.map((r, i) => (
              <Badge key={i} color="var(--warn)" bg="var(--warn-bg)">
                {r}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <ContextSources sources={state.context_sources} />
      {meta && (
        <div style={s.meta}>
          {model && <span>{t("metaModel", { model })}</span>}
          <span>{t("metaCost", { cost: formatCost(meta.cost_usd) })}</span>
          {time && <span>{t("metaGenerated", { time })}</span>}
          {sha && <span>{t("metaHead", { sha })}</span>}
        </div>
      )}
    </>
  );
}
