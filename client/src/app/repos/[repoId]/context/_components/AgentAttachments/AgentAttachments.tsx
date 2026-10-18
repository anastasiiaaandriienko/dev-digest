/* AgentAttachments — attach discovered docs to an agent for this repo. Attached
   docs are injected into that agent's review prompt; missing / outside-roots
   ones are flagged and skipped at review time. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { ContextListItem } from "@devdigest/shared";
import { ContextDocAttachments } from "@/components/context-doc-attachments";
import { useAgents } from "@/lib/hooks/agents";
import { s } from "./styles";

export function AgentAttachments({ repoId, files }: { repoId: string; files: ContextListItem[] }) {
  const t = useTranslations("context");
  const { data: agents } = useAgents();
  const [picked, setPicked] = React.useState("");
  const list = agents ?? [];
  const agentId = list.some((a) => a.id === picked) ? picked : (list[0]?.id ?? "");

  return (
    <section style={s.box} aria-label={t("attach.title")}>
      <div style={s.title}>{t("attach.title")}</div>
      <div style={s.hint}>{t("attach.hint")}</div>
      {list.length === 0 ? (
        <div style={s.hint}>{t("attach.noAgents")}</div>
      ) : (
        <>
          <SelectInput
            value={agentId}
            onChange={setPicked}
            options={list.map((a) => ({ value: a.id, label: a.name }))}
            mono={false}
            aria-label={t("attach.agentLabel")}
          />
          <ContextDocAttachments kind="agents" ownerId={agentId} repoId={repoId} files={files} />
        </>
      )}
    </section>
  );
}
