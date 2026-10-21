/* /repos/:repoId/context — Project Context folder (spec: project-context-folder, A2).
   Three-panel page: sidebar | docs panel (search, list, collapsible Roots,
   footer) | preview panel (read-only preview + attach section). There is no
   write, edit or re-index endpoint: "Re-index" only refetches the list (GET)
   and Download saves the already-cached preview text. */
"use client";

import React from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import {
  useContextFile,
  useContextList,
  useContextRoots,
  useContextUsage,
  useUpdateContextRoots,
} from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import { AgentAttachments } from "../AgentAttachments";
import { DocPreview } from "@/components/context-doc-preview";
import { RootsPanel } from "../RootsPanel";
import { NOW_UPDATE_MS, SEARCH_DEBOUNCE_MS } from "./constants";
import { downloadMarkdown, fileName, formatKb, totalSize } from "./helpers";
import { s } from "./styles";

export function ContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const format = useFormatter();
  const now = useNow({ updateInterval: NOW_UPDATE_MS });
  const { repos } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const repo = repos.find((r) => r.id === repoId);
  const [input, setInput] = React.useState("");
  const [q, setQ] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setQ(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const rootsQuery = useContextRoots(repoId);
  const list = useContextList(repoId, q);
  // Same query key as the preview inside DocPreview: Download reads the cache, no extra request.
  const file = useContextFile(repoId, selected);
  const usage = useContextUsage(repoId);
  const saveRoots = useUpdateContextRoots(repoId);
  const editDisabledId = React.useId();

  const crumb = [{ label: t("crumbLab") }, { label: t("title") }];
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const notCloned = list.error instanceof ApiError && list.error.code === "REPO_NOT_CLONED";
  const files = list.data?.files ?? [];
  const roots = list.data?.roots ?? rootsQuery.data?.roots ?? [];
  const searching = q.trim() !== "";
  const saveError =
    saveRoots.error instanceof ApiError ? saveRoots.error.message : saveRoots.error ? t("roots.error") : null;
  const updatedAt = list.dataUpdatedAt;
  // Exact, case-sensitive path match; no item = nobody uses the doc. Loading / error: no indicator.
  const usageCount = selected && usage.data ? (usage.data.items.find((i) => i.path === selected)?.agent_count ?? 0) : null;
  const canDownload = !!selected && !!file.data && !file.isLoading && !file.isError;

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <section style={s.docs} aria-label={t("docsPanelLabel")}>
          <div style={s.docsHeader}>
            <h1 style={s.title} title={repo?.full_name}>
              {t("title")}
              {repo && (
                <>
                  {" · "}
                  <span className="mono" style={s.repo}>
                    {repo.name}
                  </span>
                </>
              )}
            </h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>

          <div style={s.toolbar}>
            {/* Re-index = refetch of the list query only (a GET); nothing is written. */}
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={list.isFetching}
              onClick={() => list.refetch()}
              title={t("reindexHint")}
            >
              {t("reindex")}
            </Button>
            <Button
              kind="secondary"
              size="sm"
              icon="Download"
              disabled={!canDownload}
              title={t("downloadHint")}
              onClick={() => {
                if (selected && file.data) downloadMarkdown(fileName(selected), file.data.content);
              }}
            >
              {t("download")}
            </Button>
          </div>

          <div style={s.search}>
            <TextInput
              value={input}
              onChange={setInput}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              type="search"
            />
          </div>

          {list.isLoading && (
            <div style={s.state} aria-busy="true">
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          )}
          {list.isError && notCloned && (
            <div role="alert" style={s.stateText}>
              {t("notCloned")}
            </div>
          )}
          {list.isError && !notCloned && <ErrorState body={t("loadError")} onRetry={() => list.refetch()} />}

          {list.data?.truncated && (
            <div role="status" style={s.banner}>
              <Icon.AlertTriangle size={15} />
              <div>
                <div style={s.bannerTitle}>{t("truncated.title")}</div>
                {list.data.truncated_reasons.map((r) => (
                  <div key={r} style={s.bannerBody}>
                    {t(`truncated.${r}`)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {list.data && files.length === 0 && !searching && (
            <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body", { roots: roots.join(", ") })} />
          )}
          {list.data && files.length === 0 && searching && (
            <div style={s.stateText}>{t("noMatches", { q: q.trim() })}</div>
          )}

          {files.length > 0 ? (
            <ul style={s.list} aria-label={t("listLabel")}>
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    style={s.row(f.path === selected)}
                    aria-pressed={f.path === selected}
                    onClick={() => setSelected(f.path)}
                  >
                    <Icon.FileText size={14} />
                    <span className="mono" style={s.rowPath}>
                      {f.path}
                    </span>
                    <span style={s.rowMeta}>{t("kb", { kb: formatKb(f.size) })}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div style={s.filler} />
          )}

          {rootsQuery.data && (
            <RootsPanel
              roots={rootsQuery.data.roots}
              saving={saveRoots.isPending}
              error={saveError}
              onSave={(next) => saveRoots.mutate(next, { onSuccess: () => notify.success(t("roots.saved")) })}
            />
          )}

          {list.data && (
            <div style={s.footer}>
              <span>{t("count", { count: files.length })}</span>
              <span>{t("kb", { kb: formatKb(totalSize(files)) })}</span>
              {!!updatedAt && (
                <span>
                  {t("footer.updated", { time: format.relativeTime(Math.min(updatedAt, now.getTime()), now) })}
                </span>
              )}
            </div>
          )}
        </section>

        <section style={s.preview} aria-label={t("previewPanelLabel")}>
          {selected && (
            <div style={s.previewHeader}>
              <span className="mono" style={s.fileName} title={selected}>
                {fileName(selected)}
              </span>
              <span style={s.modes} title={t("preview.editDisabled")}>
                <button type="button" style={s.mode(true, false)} aria-pressed="true">
                  {t("preview.modePreview")}
                </button>
                <button type="button" style={s.mode(false, true)} disabled aria-describedby={editDisabledId}>
                  {t("preview.modeEdit")}
                </button>
                <span id={editDisabledId} style={s.srOnly}>
                  {t("preview.editDisabled")}
                </span>
              </span>
              {usageCount !== null && <span style={s.usage}>{t("usage.label", { count: usageCount })}</span>}
            </div>
          )}
          <div style={s.previewBody}>
            <DocPreview repoId={repoId} path={selected} fill />
            {list.data && <AgentAttachments repoId={repoId} files={files} />}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
