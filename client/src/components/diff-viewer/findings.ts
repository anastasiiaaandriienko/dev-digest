/* Inline-findings support for the DiffViewer (Files changed tab).
   Pure anchoring helper + the API shape the viewer needs. Callers pass
   findings already filtered to the current file. */
import type { ReactNode } from "react";
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_ORDER } from "../../lib/findings";
import type { Line } from "./helpers";

/** What the viewer needs to render findings inline. */
export interface DiffFindingsApi {
  items: FindingRecord[];
  /** When false, inline findings are hidden. */
  visible: boolean;
  renderCard: (f: FindingRecord) => ReactNode;
}

export interface AnchoredFindings {
  /** Line index (into `lines`) -> findings rendered under that line. */
  byLine: Map<number, FindingRecord[]>;
  /** Findings with no rendered new-side line in [start_line, end_line]. */
  unanchored: FindingRecord[];
}

function compareFindings(a: FindingRecord, b: FindingRecord): number {
  return (
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Anchor each finding to a rendered new-side line (add/ctx only): the line
 * whose newNo === end_line, else the one with the largest newNo within
 * [start_line, end_line] (one pass over rendered lines), else unanchored. No dedup; stable severity/id order.
 */
export function anchorFindings(lines: Line[], findings: FindingRecord[]): AnchoredFindings {
  const indexByNewNo = new Map<number, number>();
  lines.forEach((ln, i) => {
    if ((ln.kind === "add" || ln.kind === "ctx") && ln.newNo != null) indexByNewNo.set(ln.newNo, i);
  });

  const byLine = new Map<number, FindingRecord[]>();
  const unanchored: FindingRecord[] = [];

  for (const f of [...findings].sort(compareFindings)) {
    let idx = Number.isFinite(f.end_line) ? indexByNewNo.get(f.end_line) : undefined;
    if (idx === undefined && Number.isFinite(f.start_line) && Number.isFinite(f.end_line)) {
      // Work is proportional to rendered lines, never to the (untrusted) claimed range.
      const lo = Math.min(f.start_line, f.end_line);
      const hi = Math.max(f.start_line, f.end_line);
      let best = -Infinity;
      for (const [newNo, i] of indexByNewNo) {
        if (newNo >= lo && newNo <= hi && newNo > best) {
          best = newNo;
          idx = i;
        }
      }
    }
    if (idx === undefined) {
      unanchored.push(f);
    } else {
      const list = byLine.get(idx) ?? [];
      list.push(f);
      byLine.set(idx, list);
    }
  }
  return { byLine, unanchored };
}
