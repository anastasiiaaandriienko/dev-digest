/* SmartGroup — one role group of the Smart-order diff: a toggle row (chevron,
   colour square, label, hint, files-with-findings dot, file count) + its files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SmartGroupKey } from "@/lib/smart-diff";
import { GROUP_COLOR, GROUP_HINT_KEY, GROUP_LABEL_KEY } from "./constants";
import { s } from "./styles";

export function SmartGroup({
  groupKey,
  fileCount,
  filesWithFindings,
  open,
  onToggle,
  children,
}: {
  groupKey: SmartGroupKey;
  fileCount: number;
  /** Number of files in the group that have at least one finding. */
  filesWithFindings: number;
  open: boolean;
  onToggle: () => void;
  /** The group's DiffViewer; rendered only while the group is open. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  // An empty group is still listed ("0 files") but there is nothing to expand.
  const expandable = fileCount > 0;
  const expanded = expandable && open;
  return (
    <div style={s.wrap} data-testid={`smart-group-${groupKey}`}>
      <button
        type="button"
        aria-expanded={expanded}
        disabled={!expandable}
        onClick={onToggle}
        style={s.header(expandable)}
      >
        <Icon.ChevronRight size={13} style={s.chevron(expanded, expandable)} />
        <span aria-hidden="true" style={s.square(GROUP_COLOR[groupKey])} />
        <span style={s.label}>{t(GROUP_LABEL_KEY[groupKey])}</span>
        <span style={s.hint}>{t(GROUP_HINT_KEY[groupKey])}</span>
        {filesWithFindings > 0 && (
          <span style={s.findingsBadge} title={t("smartDiff.filesWithFindings", { count: filesWithFindings })}>
            <span aria-hidden="true" style={s.dot} />
            {filesWithFindings}
          </span>
        )}
        <span className="tnum" style={s.count}>
          {t("smartDiff.filesCount", { count: fileCount })}
        </span>
      </button>
      {expanded && children}
    </div>
  );
}
