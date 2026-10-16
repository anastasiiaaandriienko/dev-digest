/* UnanchoredFindings — findings of a file with no rendered new-side line
   (e.g. on removed or unchanged code); shown as a block at the end of the file. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { DiffFindingsApi } from "../findings";
import { s } from "../styles";

export function UnanchoredFindings({
  findings,
  items,
  title,
}: {
  findings: DiffFindingsApi;
  items: FindingRecord[];
  /** Overrides the default "not on changed lines" heading. */
  title?: string;
}) {
  const t = useTranslations("prReview");
  return (
    <div style={s.unanchored}>
      <div style={s.unanchoredTitle}>{title ?? t("smartDiff.unanchoredTitle")}</div>
      <div style={s.unanchoredList}>
        {items.map((f) => (
          <React.Fragment key={f.id}>{findings.renderCard(f)}</React.Fragment>
        ))}
      </div>
    </div>
  );
}
