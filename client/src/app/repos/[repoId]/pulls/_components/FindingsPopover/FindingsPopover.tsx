/* FindingsPopover — the PR list's read-only findings popover (L01, client
   spec §4, option P1). Hovering or keyboard-focusing the PR ROW (after a short
   delay), or clicking its FINDINGS indicator, opens a popover with the LATEST
   review's severity counts, open criticals, verdict and top findings. Data is
   fetched lazily with usePrReviews — only when opened and only for reviewed
   PRs — and shares the ["reviews", prId] cache with the PR detail page. It
   never changes data. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, SEV, SeverityBadge, Skeleton } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import type { ReviewRecord } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import {
  countBySeverity,
  findingLocation,
  openCriticals,
  severityKeys,
  topFindings,
  type SeverityKey,
} from "@/lib/findings";
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS, POPOVER_WIDTH, TOP_FINDINGS } from "./constants";
import { s } from "./styles";

/** Latest persisted "review" (newest-first from the API), as the list's score uses. */
export function latestReview(reviews: ReviewRecord[] | undefined): ReviewRecord | undefined {
  return reviews?.find((r) => r.kind === "review");
}

export interface FindingsPopoverController {
  open: boolean;
  pos: { top: number; left: number } | null;
  popId: string;
  /** The PR row container (hover target; not itself interactive). */
  rowRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The wrapper of the FINDINGS button: the popover is anchored under it. */
  anchorRef: React.MutableRefObject<HTMLSpanElement | null>;
  /** The FINDINGS button: activation target and where focus returns. */
  indicatorRef: React.MutableRefObject<HTMLButtonElement | null>;
  popRef: React.MutableRefObject<HTMLDivElement | null>;
  show: () => void;
  hide: () => void;
  /** Explicit open (FINDINGS button): opens at once and moves focus inside. */
  activate: () => void;
  /** Close and put focus back on the FINDINGS button (without reopening). */
  returnToIndicator: () => void;
  scheduleOpen: () => void;
  scheduleClose: () => void;
  cancelTimers: () => void;
  /** Handlers for the PR row container: hover and focus-within preview it. */
  rowHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (e: React.FocusEvent) => void;
  };
}

/** Focusable elements inside an element, in DOM order. */
export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
}

/**
 * Open/close state for one PR row's findings popover.
 * - PREVIEW: hovering the row, or keyboard focus on any of its controls (the
 *   PR title link, the FINDINGS button), opens it after HOVER_OPEN_DELAY_MS, so
 *   sweeping the pointer or tabbing past fetches nothing. Leaving / blurring
 *   closes it after a short grace.
 * - ACTIVATE: clicking (or Enter / Space on) the FINDINGS button opens it at
 *   once and moves focus into it, so keyboard users can reach its link.
 * - Escape closes it. Focus inside the popover or on the button returns to the
 *   button without reopening; focus elsewhere (e.g. the title link) stays put.
 *   Scrolling closes it (it is fixed-positioned).
 */
export function useFindingsPopover(): FindingsPopoverController {
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const open = pos != null;
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const indicatorRef = React.useRef<HTMLButtonElement | null>(null);
  const popRef = React.useRef<HTMLDivElement | null>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipFocusOpen = React.useRef(false);
  const focusOnOpen = React.useRef(false);
  const popId = React.useId();

  const cancelTimers = React.useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }, []);
  const show = React.useCallback(() => {
    cancelTimers();
    const r = (anchorRef.current ?? rowRef.current)?.getBoundingClientRect();
    if (!r) return;
    const maxLeft = Math.max(8, window.innerWidth - POPOVER_WIDTH - 8);
    setPos({ top: r.bottom + 6, left: Math.min(r.left, maxLeft) });
  }, [cancelTimers]);
  const hide = React.useCallback(() => {
    cancelTimers();
    setPos(null);
  }, [cancelTimers]);
  const scheduleOpen = React.useCallback(() => {
    cancelTimers();
    openTimer.current = setTimeout(show, HOVER_OPEN_DELAY_MS);
  }, [cancelTimers, show]);
  const scheduleClose = React.useCallback(() => {
    cancelTimers();
    closeTimer.current = setTimeout(hide, HOVER_CLOSE_DELAY_MS);
  }, [cancelTimers, hide]);

  const returnToIndicator = React.useCallback(() => {
    hide();
    skipFocusOpen.current = true;
    indicatorRef.current?.focus();
    skipFocusOpen.current = false;
  }, [hide]);
  const activate = React.useCallback(() => {
    focusOnOpen.current = true;
    show();
  }, [show]);

  // After an explicit activation, move focus into the popover: its first
  // control ("Open findings →"), or the dialog itself while it has none
  // (loading / error / not reviewed).
  React.useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const target = focusablesIn(popRef.current)[0] ?? popRef.current;
    skipFocusOpen.current = true;
    target?.focus();
    skipFocusOpen.current = false;
  }, [open, pos]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Read focus BEFORE hiding: the popover's content is about to unmount.
      const active = document.activeElement;
      if (active && (popRef.current?.contains(active) || active === indicatorRef.current)) {
        returnToIndicator();
      } else {
        // Mouse open, or keyboard preview from the title link: focus stays.
        hide();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, hide, returnToIndicator]);
  React.useEffect(() => cancelTimers, [cancelTimers]);

  const rowHandlers = {
    onMouseEnter: scheduleOpen,
    onMouseLeave: scheduleClose,
    onFocus: () => {
      if (!skipFocusOpen.current) scheduleOpen();
    },
    onBlur: (e: React.FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (rowRef.current?.contains(to) || popRef.current?.contains(to)) return;
      scheduleClose();
    },
  };

  return {
    open,
    pos,
    popId,
    rowRef,
    anchorRef,
    indicatorRef,
    popRef,
    show,
    hide,
    activate,
    returnToIndicator,
    scheduleOpen,
    scheduleClose,
    cancelTimers,
    rowHandlers,
  };
}

/**
 * The FINDINGS button (a regular tab stop, `aria-haspopup="dialog"`) and the
 * portal popover. State comes from the row's `useFindingsPopover`.
 */
export function FindingsPopover({
  pr,
  repoId,
  pop,
}: {
  pr: PrMeta;
  repoId: string;
  pop: FindingsPopoverController;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const reviewed = pr.score != null; // same rule as the score ring
  const { open, pos } = pop;

  // Lazy: no request until opened, and never for a PR without a review.
  const reviews = usePrReviews(open && reviewed ? pr.id ?? null : null);

  const href = `/repos/${repoId}/pulls/${pr.number}?tab=findings`;

  return (
    <span ref={pop.anchorRef} style={s.wrap}>
      <button
        ref={pop.indicatorRef}
        type="button"
        data-testid="findings-indicator"
        aria-label={t("list.findings.label")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? pop.popId : undefined}
        style={s.trigger(reviewed, open)}
        onClick={(e) => {
          // Click / Enter / Space: open at once and move focus inside. It must
          // not navigate the row.
          e.stopPropagation();
          pop.activate();
        }}
      >
        <Icon.MessageSquare size={12} />
        {t("list.findings.short")}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop.popRef}
            id={pop.popId}
            role="dialog"
            tabIndex={-1}
            aria-label={t("list.findings.popoverLabel", { number: pr.number })}
            style={s.popover(pos.top, pos.left)}
            onMouseEnter={pop.cancelTimers}
            onMouseLeave={pop.scheduleClose}
            // React events bubble through portals to the row: keep clicks
            // inside the popover from navigating it. (Keys are NOT stopped:
            // that would also stop the native event before the window-level
            // Escape listener.)
            onClick={(e) => e.stopPropagation()}
            // The popover lives at the end of <body>: leaving it with Tab /
            // Shift+Tab would jump to the page's end. Instead, leaving past its
            // first / last control closes it and returns to the FINDINGS button.
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const items = focusablesIn(pop.popRef.current);
              const i = items.indexOf(document.activeElement as HTMLElement);
              const leaving = e.shiftKey ? i <= 0 : i === items.length - 1;
              if (leaving) {
                e.preventDefault();
                pop.returnToIndicator();
              }
            }}
            // Focus leaving to somewhere outside the row and popover closes it.
            onBlur={(e) => {
              const to = e.relatedTarget as Node | null;
              if (pop.popRef.current?.contains(to) || pop.rowRef.current?.contains(to)) return;
              pop.scheduleClose();
            }}
          >
            <PopoverBody
              reviewed={reviewed}
              loading={reviews.isLoading}
              failed={reviews.isError}
              review={latestReview(reviews.data)}
              href={href}
              onOpen={(e) => {
                e.preventDefault();
                pop.hide();
                router.push(href);
              }}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}

function PopoverBody({
  reviewed,
  loading,
  failed,
  review,
  href,
  onOpen,
}: {
  reviewed: boolean;
  loading: boolean;
  failed: boolean;
  review: ReviewRecord | undefined;
  href: string;
  onOpen: (e: React.MouseEvent) => void;
}) {
  const t = useTranslations("prReview");
  if (!reviewed) return <div style={s.note}>{t("list.findings.notReviewed")}</div>;
  if (loading) {
    return (
      <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={s.note}>{t("list.findings.loading")}</span>
        <Skeleton height={14} />
        <Skeleton height={14} width="80%" />
      </div>
    );
  }
  if (failed) return <div style={s.error}>{t("list.findings.error")}</div>;
  if (!review) return <div style={s.note}>{t("list.findings.noReview")}</div>;

  const findings = review.findings;
  const counts = countBySeverity(findings);
  const top = topFindings(findings, TOP_FINDINGS);
  const more = findings.length - top.length;
  const crit = openCriticals(findings);

  return (
    <>
      <div style={s.header}>
        <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
        <span>{review.agent_name ?? t("list.findings.agent")}</span>
        {review.verdict && <span style={s.verdict}>· {t(`list.findings.verdict.${review.verdict}`)}</span>}
      </div>
      <div style={s.counts} aria-label={t("list.findings.countsLabel")}>
        {severityKeys(counts).map((k: SeverityKey) => (
          <span key={k} data-severity={k} title={t(`severity.${k}`)}>
            <SeverityBadge severity={k} count={counts[k]} compact />
          </span>
        ))}
      </div>
      <div style={s.meta}>
        {t("list.findings.total", { count: findings.length })}
        {crit > 0 ? ` · ${t("list.findings.openCriticals", { count: crit })}` : ""}
      </div>
      {findings.length === 0 ? (
        <div style={s.note}>{t("list.findings.empty")}</div>
      ) : (
        <ul style={s.list}>
          {top.map((f) => (
            <li key={f.id} style={s.item}>
              <SeverityBadge severity={f.severity in SEV ? (f.severity as SeverityKey) : "INFO"} compact />
              <div style={s.itemText}>
                <span style={s.itemTitle(!!f.dismissed_at)} title={f.title}>
                  {f.title}
                </span>
                <span className="mono" style={s.itemLoc}>
                  {findingLocation(f)}
                </span>
              </div>
            </li>
          ))}
          {more > 0 && <li style={s.meta}>{t("list.findings.more", { count: more })}</li>}
        </ul>
      )}
      <a href={href} onClick={onOpen} style={s.link}>
        {t("list.findings.open")}
      </a>
    </>
  );
}
