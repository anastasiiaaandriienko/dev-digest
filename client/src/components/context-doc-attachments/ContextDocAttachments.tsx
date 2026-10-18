/* ContextDocAttachments — the docs attached to ONE agent or skill for ONE repo:
   pick a discovered doc to attach, see each attachment's status, detach one.
   Shared by the Context page (agents) and the skill Context tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SelectInput } from "@devdigest/ui";
import type { ContextListItem } from "@devdigest/shared";
import { ContextDocStatus } from "@/components/context-doc-status";
import {
  useAttachContextDoc,
  useContextDocs,
  useDetachContextDoc,
  type ContextOwnerKind,
} from "@/lib/hooks/context";
import { MAX_ATTACHMENTS } from "./constants";
import { s } from "./styles";

export function ContextDocAttachments({
  kind,
  ownerId,
  repoId,
  files,
}: {
  kind: ContextOwnerKind;
  ownerId: string;
  repoId: string;
  /** Discovered docs of the repo (the only ones that can be attached). */
  files: ContextListItem[];
}) {
  const t = useTranslations("context");
  const docs = useContextDocs(kind, ownerId, repoId);
  const attach = useAttachContextDoc(kind, ownerId, repoId);
  const detach = useDetachContextDoc(kind, ownerId, repoId);
  const [path, setPath] = React.useState("");

  const attached = docs.data ?? [];
  const taken = new Set(attached.map((a) => a.path));
  const options = [
    { value: "", label: t("attach.pickDoc") },
    ...files.filter((f) => !taken.has(f.path)).map((f) => ({ value: f.path, label: f.path })),
  ];
  const full = attached.length >= MAX_ATTACHMENTS;

  return (
    <div style={s.wrap}>
      <div style={s.picker}>
        <div style={s.pickerSelect}>
          <SelectInput value={path} onChange={setPath} options={options} aria-label={t("attach.docLabel")} />
        </div>
        <Button
          kind="primary"
          size="sm"
          icon="Plus"
          disabled={!path || full || attach.isPending}
          onClick={() => attach.mutate(path, { onSuccess: () => setPath("") })}
        >
          {attach.isPending ? t("attach.attaching") : t("attach.attach")}
        </Button>
      </div>
      {full && <div style={s.muted}>{t("attach.limit")}</div>}
      {docs.isError && (
        <div role="alert" style={s.muted}>
          {t("attach.loadError")}
        </div>
      )}
      {docs.data && attached.length === 0 && <div style={s.muted}>{t("attach.none")}</div>}
      {attached.length > 0 && (
        <ul style={s.list} aria-label={t("attach.listLabel")}>
          {attached.map((a) => (
            <li key={a.id} style={s.row} data-attachment-id={a.id}>
              <span className="mono" style={s.path}>
                {a.path}
              </span>
              <ContextDocStatus status={a.status} />
              <Button
                kind="ghost"
                size="sm"
                icon="X"
                aria-label={t("attach.detach", { path: a.path })}
                disabled={detach.isPending}
                onClick={() => detach.mutate(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
