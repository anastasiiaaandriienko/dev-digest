/* ContextTab — project context docs attached to this skill, per repository.
   Pick a repo, then attach discovered docs; they are injected after the
   agent's own docs whenever the skill runs on that repo. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ContextDocAttachments } from "@/components/context-doc-attachments";
import { useContextList } from "@/lib/hooks/context";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("context");
  const { repos, repoId: activeId } = useActiveRepo();
  const [picked, setPicked] = React.useState("");
  const repoId = repos.some((r) => r.id === picked) ? picked : (repos.find((r) => r.id === activeId)?.id ?? repos[0]?.id ?? "");
  const list = useContextList(repoId || null, "");

  return (
    <div style={s.wrap}>
      <h2 style={s.h2}>{t("tab.title")}</h2>
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
        </>
      )}
    </div>
  );
}
