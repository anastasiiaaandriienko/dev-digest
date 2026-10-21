/* ContextTab — project context docs attached to this skill, per repository.
   Pick a repo, then attach discovered docs; they are injected after the
   agent's own docs (inside each prompt heading) whenever the skill runs on that
   repo. "Serializes as" previews that prompt section. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, SelectInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextDocAttachments } from "@/components/context-doc-attachments";
import { useContextDocs, useContextList } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { SerializesAs } from "./_components/SerializesAs";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { repos, repoId: activeId } = useActiveRepo();
  const [picked, setPicked] = React.useState("");
  const repoId = repos.some((r) => r.id === picked) ? picked : (repos.find((r) => r.id === activeId)?.id ?? repos[0]?.id ?? "");
  const list = useContextList(repoId || null, "");
  // Same query key as inside ContextDocAttachments: no extra request.
  const docs = useContextDocs("skills", skill.id, repoId || null);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        {repos.length > 0 && docs.data && <Badge>{t("skillTab.attached", { count: docs.data.length })}</Badge>}
      </div>
      <p style={s.subtitle}>{t("attach.hint")}</p>
      {repos.length === 0 ? (
        <p style={s.subtitle}>{t("tab.noRepo")}</p>
      ) : (
        <>
          <SelectInput
            value={repoId}
            onChange={setPicked}
            options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
            aria-label={t("tab.repoLabel")}
          />
          <ContextDocAttachments kind="skills" ownerId={skill.id} repoId={repoId} files={list.data?.files ?? []} />
          {list.data && docs.data && (
            <SerializesAs attachments={docs.data} files={list.data.files} roots={list.data.roots} />
          )}
        </>
      )}
    </div>
  );
}
