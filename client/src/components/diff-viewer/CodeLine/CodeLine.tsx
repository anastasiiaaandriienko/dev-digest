/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import type { FindingRecord } from "@devdigest/shared";
import { FINDING_SEV_COLOR, FINDING_SEV_FALLBACK } from "../constants";
import type { DiffFindingsApi } from "../findings";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, findingLineBorderFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  lineFindings,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Inline-findings API; cards render only while `findings.visible`. */
  findings?: DiffFindingsApi;
  /** Findings anchored to this line (already sorted by severity). */
  lineFindings?: FindingRecord[];
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const cards = findings?.visible && lineFindings && lineFindings.length > 0 ? lineFindings : null;
  const topSev = cards ? cards[0]!.severity : null;
  const sevColor = topSev ? (FINDING_SEV_COLOR[topSev] ?? FINDING_SEV_FALLBACK) : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={sevColor ? { ...lineRowFor(ln.kind), ...findingLineBorderFor(sevColor) } : lineRowFor(ln.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {topSev && sevColor && <span style={{ ...s.findingPill, color: sevColor }}>{topSev}</span>}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {cards && findings && (
        <div style={s.findingCards}>
          {cards.map((f) => (
            <React.Fragment key={f.id}>{findings.renderCard(f)}</React.Fragment>
          ))}
        </div>
      )}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
