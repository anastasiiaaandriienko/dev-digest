"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, UnanchoredFindings, hasNewSideLine, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { buildSmartGroups, defaultGroupOpen, type SmartGroupKey } from "@/lib/smart-diff";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import { InlineFinding } from "./_components/InlineFinding";
import { OrderToggle, type DiffOrder } from "./_components/OrderToggle";
import { SmartGroup } from "./_components/SmartGroup";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Findings to show inline (latest completed review of each agent). */
  findings?: FindingRecord[];
  /** review_id -> agent name, for the label above each inline finding. */
  agentNames?: Record<string, string | null>;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Deep link from the PR Brief: file path (+ new-side line) to open and scroll to. */
  focusFile?: string | null;
  focusLine?: number | null;
}

const NO_FINDINGS: FindingRecord[] = [];

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  findings = NO_FINDINGS,
  agentNames,
  repoFullName,
  headSha,
  focusFile = null,
  focusLine = null,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  // Pure client-side view state: switching order / hiding findings sends no request.
  const [order, setOrder] = React.useState<DiffOrder>("original");
  const [showFindings, setShowFindings] = React.useState(true);
  // Manual open/close per smart group; unset = defaultGroupOpen (derived).
  const [groupOpen, setGroupOpen] = React.useState<Partial<Record<SmartGroupKey, boolean>>>({});

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const findingsApi: DiffFindingsApi = React.useMemo(
    () => ({
      items: findings,
      visible: showFindings,
      renderCard: (f) => (
        <InlineFinding
          f={f}
          agentName={agentNames?.[f.review_id]}
          prId={prId}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ),
    }),
    [findings, showFindings, agentNames, prId, repoFullName, headSha],
  );

  // Findings on files absent from the diff render in no FileCard — show them in one block.
  const outsideDiff = React.useMemo(() => {
    const paths = new Set(files.map((f) => f.path));
    return findings.filter((f) => !paths.has(f.file));
  }, [files, findings]);

  // Deep-link notice: the file is not in the diff, or the line is not a rendered new-side line.
  const focusNotice = React.useMemo(() => {
    if (!focusFile) return null;
    const file = files.find((f) => f.path === focusFile);
    if (!file) return { kind: "missingFile" as const, path: focusFile };
    if (focusLine != null && !hasNewSideLine(file.patch, focusLine)) {
      return { kind: "missingLine" as const, path: focusFile, line: focusLine };
    }
    return null;
  }, [files, focusFile, focusLine]);

  const groups = React.useMemo(() => buildSmartGroups(files, findings), [files, findings]);
  const totals = React.useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ additions: acc.additions + (f.additions ?? 0), deletions: acc.deletions + (f.deletions ?? 0) }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.actions}>
            <OrderToggle value={order} onChange={setOrder} />
            {findings.length > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showFindings ? "EyeOff" : "Eye"}
                onClick={() => setShowFindings((v) => !v)}
              >
                {showFindings ? t("smartDiff.hideFindings") : t("smartDiff.showFindings")} ({findings.length})
              </Button>
            )}
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {focusNotice && (
        <div role="status" style={s.notice}>
          {focusNotice.kind === "missingFile"
            ? t("smartDiff.focusMissingFile", { path: focusNotice.path })
            : t("smartDiff.focusMissingLine", { path: focusNotice.path, line: focusNotice.line })}
        </div>
      )}
      <div style={s.stats}>
        {order === "smart" && <>{t("smartDiff.groupedByRole")} · </>}
        {t("smartDiff.diffStats", { count: files.length, ...totals })}
      </div>

      {order === "original" ? (
        <DiffViewer files={files} commenting={commenting} findings={findingsApi} focusPath={focusFile} />
      ) : (
        <div style={s.groups}>
          {groups.map((g) => (
            <SmartGroup
              key={g.key}
              groupKey={g.key}
              fileCount={g.files.length}
              filesWithFindings={g.filesWithFindings}
              open={
                groupOpen[g.key] ??
                (g.files.some((f) => f.path === focusFile) || defaultGroupOpen(g.key, g.filesWithFindings))
              }
              onToggle={() =>
                setGroupOpen((prev) => ({
                  ...prev,
                  [g.key]: !(
                    prev[g.key] ??
                    (g.files.some((f) => f.path === focusFile) || defaultGroupOpen(g.key, g.filesWithFindings))
                  ),
                }))
              }
            >
              <DiffViewer files={g.files} commenting={commenting} findings={findingsApi} focusPath={focusFile} />
            </SmartGroup>
          ))}
        </div>
      )}

      {showFindings && outsideDiff.length > 0 && (
        <div style={s.outside}>
          <UnanchoredFindings
            findings={findingsApi}
            items={outsideDiff}
            title={t("smartDiff.outsideDiffTitle")}
          />
        </div>
      )}
    </section>
  );
}
