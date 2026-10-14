/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { PrMeta } from "@/lib/types";
import { formatCost } from "@/lib/format";
import { FindingsPopover, useFindingsPopover } from "../FindingsPopover";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null; // null score ⇒ PR has never been reviewed
  // L01: hovering the row, or keyboard focus on its title link / FINDINGS
  // button, previews the findings popover.
  const pop = useFindingsPopover();
  const prHref = `/repos/${repoId}/pulls/${pr.number}`;
  return (
    // A plain container: clicking anywhere on it is a mouse convenience; the
    // keyboard / screen-reader entry points are the title link and the
    // FINDINGS button (no interactive control nested in another one).
    <div
      ref={pop.rowRef}
      onMouseEnter={() => {
        setH(true);
        pop.rowHandlers.onMouseEnter();
      }}
      onMouseLeave={() => {
        setH(false);
        pop.rowHandlers.onMouseLeave();
      }}
      onFocus={pop.rowHandlers.onFocus}
      onBlur={pop.rowHandlers.onBlur}
      onClick={(e) => {
        // Links and buttons inside the row handle their own clicks.
        if ((e.target as HTMLElement).closest("a, button")) return;
        router.push(prHref);
      }}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>
            <a
              href={prHref}
              aria-describedby={pop.open ? pop.popId : undefined}
              style={s.rowTitleLink}
              onClick={(e) => {
                // Let the browser handle new-tab / new-window clicks.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                router.push(prHref);
              }}
            >
              {pr.title}
            </a>
          </div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
        <FindingsPopover pr={pr} repoId={repoId} pop={pop} />
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div
        className="mono"
        style={s.costCell(pr.cost_usd != null)}
        title={t(
          pr.cost_usd == null
            ? "list.costUnknownHint"
            : pr.cost_partial
              ? "list.costPartialHint"
              : "list.costHint",
        )}
      >
        {formatCost(pr.cost_usd, { partial: pr.cost_partial })}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
