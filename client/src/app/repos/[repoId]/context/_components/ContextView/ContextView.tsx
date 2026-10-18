/* /repos/:repoId/context — Project Context folder (spec: project-context-folder).
   Shows the effective roots (editable), a searchable list of the repo's
   discovered Markdown docs and a READ-ONLY preview. There is no write, edit or
   re-index endpoint: "Re-index" only refetches the list (GET). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useContextList, useContextRoots, useUpdateContextRoots } from "@/lib/hooks/context";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { notify } from "@/lib/toast";
import { AgentAttachments } from "../AgentAttachments";
import { DocPreview } from "@/components/context-doc-preview";
import { RootsEditor } from "../RootsEditor";
import { SEARCH_DEBOUNCE_MS } from "./constants";
import { formatKb } from "./helpers";
import { s } from "./styles";

export function ContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
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
  const saveRoots = useUpdateContextRoots(repoId);

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

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.grow}>
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
        </div>

        {rootsQuery.data && (
          <RootsEditor
            roots={rootsQuery.data.roots}
            saving={saveRoots.isPending}
            error={saveError}
            onSave={(next) => saveRoots.mutate(next, { onSuccess: () => notify.success(t("roots.saved")) })}
          />
        )}

        <div style={s.toolbar}>
          <div style={s.search}>
            <TextInput
              value={input}
              onChange={setInput}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              type="search"
            />
          </div>
          {list.data && <span style={s.count}>{t("count", { count: files.length })}</span>}
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

        {files.length > 0 && (
          <div style={s.split}>
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
            <DocPreview repoId={repoId} path={selected} />
          </div>
        )}

        {list.data && <AgentAttachments repoId={repoId} files={files} />}
      </div>
    </AppShell>
  );
}
