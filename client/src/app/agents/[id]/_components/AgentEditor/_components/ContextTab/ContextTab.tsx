/* ContextTab — project context docs of ONE agent, per repository (spec
   project-context-folder, amendment A1). Pick a repo, attach/detach discovered
   docs with a checkbox, filter the loaded list, preview a doc read-only.
   Server truth only: attachments come from the shared `contextDocsKey` query. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, SelectInput, Skeleton, TextInput } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ContextDocStatus } from "@/components/context-doc-status";
import { DocPreview } from "@/components/context-doc-preview";
import { ApiError } from "@/lib/api";
import {
  useAttachContextDoc,
  useContextDocs,
  useContextList,
  useDetachContextDoc,
  useReorderContextDocs,
} from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { BADGED_STATUSES, MAX_ATTACHMENTS, ROOT_NEUTRAL, ROOT_STYLE } from "./constants";
import { buildRows, dropOn, filterRows, formatKb, moveBy, rootKind, rootOf, sameIds, splitPath } from "./helpers";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { repos, repoId: activeId } = useActiveRepo();
  const [picked, setPicked] = React.useState("");
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const repoId = repos.some((r) => r.id === picked)
    ? picked
    : (repos.find((r) => r.id === activeId)?.id ?? repos[0]?.id ?? "");

  const list = useContextList(repoId || null, "");
  const docs = useContextDocs("agents", agent.id, repoId || null);
  const attach = useAttachContextDoc("agents", agent.id, repoId);
  const detach = useDetachContextDoc("agents", agent.id, repoId);
  const reorder = useReorderContextDocs("agents", agent.id, repoId);

  if (repos.length === 0) {
    return (
      <div style={s.wrap}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <p style={s.subtitle}>{t("tab.noRepo")}</p>
      </div>
    );
  }

  const notCloned = list.error instanceof ApiError && list.error.code === "REPO_NOT_CLONED";
  const files = list.data?.files ?? [];
  const roots = list.data?.roots ?? [];
  const attachments = docs.data ?? [];
  const rows = filterRows(buildRows(attachments, files), filter);
  const full = attachments.length >= MAX_ATTACHMENTS;
  const busy = attach.isPending || detach.isPending || reorder.isPending;
  // AC-96: a filtered view would make the new order ambiguous; writes must not overlap.
  const canReorder = !busy && filter.trim() === "";
  const ids = attachments.map((a) => a.id);
  const commit = (next: string[]) => {
    if (!sameIds(next, ids)) reorder.mutate(next);
  };
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  const showList = !list.isLoading && (!list.isError || notCloned);

  const changeRepo = (id: string) => {
    setPicked(id);
    setPreviewPath(null);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("agentTab.title")}</h2>
        {list.data && <Badge>{t("agentTab.badge", { attached: attachments.length, total: files.length })}</Badge>}
      </div>
      <p style={s.subtitle}>{t("agentTab.helper")}</p>
      <div style={s.controls}>
        <div style={s.controlCell}>
          <SelectInput
            value={repoId}
            onChange={changeRepo}
            options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
            aria-label={t("tab.repoLabel")}
          />
        </div>
        <div style={s.controlCell}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("agentTab.filterPlaceholder")}
            aria-label={t("agentTab.filterLabel")}
            type="search"
          />
        </div>
      </div>

      {list.isLoading && (
        <div aria-busy="true">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      )}
      {notCloned && (
        <div role="alert" style={s.stateText}>
          {t("notCloned")}
        </div>
      )}
      {list.isError && !notCloned && <ErrorState body={t("loadError")} onRetry={() => list.refetch()} />}
      {docs.isError && (
        <div role="alert" style={s.muted}>
          {t("attach.loadError")}
        </div>
      )}
      {reorder.isError && (
        <div role="alert" style={s.muted}>
          {t("agentTab.reorderError")}
        </div>
      )}
      {full && !notCloned && <div style={s.muted}>{t("attach.limit")}</div>}

      {showList && rows.length === 0 && (
        <div style={s.stateText}>
          {filter.trim() ? t("agentTab.noMatches", { q: filter.trim() }) : t("agentTab.empty")}
        </div>
      )}
      {showList && rows.length > 0 && (
        <div style={s.split}>
          <ul style={s.list} aria-label={t("attach.listLabel")}>
            {rows.map((r) => {
              const { name, folder } = splitPath(r.path);
              const root = rootOf(r.path, roots);
              const look = (root && ROOT_STYLE[rootKind(root)]) || ROOT_NEUTRAL;
              return (
                <li
                  key={r.path}
                  style={{
                    ...s.row,
                    ...(dragId && dragId === r.attachmentId ? s.rowDragging : {}),
                    ...(dragId && overId === r.attachmentId && dragId !== r.attachmentId ? s.rowDrop : {}),
                  }}
                  data-path={r.path}
                  draggable={canReorder && !!r.attachmentId}
                  onDragStart={(e) => {
                    if (!canReorder || !r.attachmentId) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", r.attachmentId);
                    setDragId(r.attachmentId);
                  }}
                  onDragEnd={endDrag}
                  onDragOver={
                    dragId && r.attachmentId
                      ? (e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setOverId(r.attachmentId!);
                        }
                      : undefined
                  }
                  onDrop={
                    dragId && r.attachmentId
                      ? (e) => {
                          e.preventDefault();
                          commit(dropOn(ids, dragId, r.attachmentId!));
                          endDrag();
                        }
                      : undefined
                  }
                >
                  {r.attached && r.attachmentId && (
                    <span style={s.handle} title={t("agentTab.drag", { path: r.path })} aria-hidden="true">
                      ⠿
                    </span>
                  )}
                  {!notCloned && (
                    <input
                      type="checkbox"
                      checked={r.attached}
                      disabled={busy || (!r.attached && full)}
                      aria-label={r.path}
                      onChange={() => {
                        if (r.attached && r.attachmentId) detach.mutate(r.attachmentId);
                        else if (!r.attached) attach.mutate(r.path);
                      }}
                    />
                  )}
                  <span style={s.rowText}>
                    <span className="mono" style={s.name}>
                      {name}
                    </span>
                    {folder && (
                      <span className="mono" style={s.folder}>
                        {folder}
                      </span>
                    )}
                  </span>
                  {root && (
                    <Badge color={look.color} bg={look.bg}>
                      {root}
                    </Badge>
                  )}
                  {r.size !== undefined && <span style={s.size}>{t("kb", { kb: formatKb(r.size) })}</span>}
                  {r.status && BADGED_STATUSES.includes(r.status) && <ContextDocStatus status={r.status} />}
                  {r.attached && r.attachmentId && (
                    <>
                      <button
                        type="button"
                        style={s.move}
                        aria-label={t("agentTab.moveUp", { path: r.path })}
                        disabled={!canReorder || ids.indexOf(r.attachmentId) <= 0}
                        onClick={() => commit(moveBy(ids, r.attachmentId!, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        style={s.move}
                        aria-label={t("agentTab.moveDown", { path: r.path })}
                        disabled={!canReorder || ids.indexOf(r.attachmentId) >= ids.length - 1}
                        onClick={() => commit(moveBy(ids, r.attachmentId!, 1))}
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    style={s.size}
                    aria-label={t("agentTab.previewLabel", { path: r.path })}
                    aria-pressed={previewPath === r.path}
                    onClick={() => setPreviewPath(r.path)}
                  >
                    {t("agentTab.preview")}
                  </button>
                </li>
              );
            })}
          </ul>
          <DocPreview repoId={repoId} path={previewPath} />
        </div>
      )}
      <p style={s.footer}>{t("agentTab.footer")}</p>
    </div>
  );
}
