/* /skills/:id — Skill page (HW2 #25): header (type, name, version, status) and
   the Config / Preview / Versioning tabs, kept in `?tab=` like the agent editor.
   Deleting from the Config tab reuses DeleteSkillModal and returns to /skills. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api";
import { useSkill } from "@/lib/hooks/skills";
import { TYPE_COLOR } from "../../../constants";
import { DeleteSkillModal } from "../../../_components/DeleteSkillModal";
import { ConfigTab } from "./_components/ConfigTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersioningTab } from "./_components/VersioningTab";
import { DEFAULT_TAB, TABS, type SkillTab } from "./constants";
import { s } from "./styles";

export function SkillDetailView() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const [deleting, setDeleting] = React.useState(false);

  const requested = search.get("tab");
  const tab: SkillTab["key"] = TABS.some((tb) => tb.key === requested) ? (requested as SkillTab["key"]) : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`, { scroll: false });
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];
  // Error states only when there is nothing to show: a failed BACKGROUND refetch
  // keeps the cached skill (React Query leaves `data`), so the page stays usable.
  const failed = isError && !skill;
  const notFound = failed && error instanceof ApiError && error.status === 404;

  return (
    <AppShell crumb={crumb}>
      {deleting && skill && (
        <DeleteSkillModal skill={skill} onClose={() => setDeleting(false)} onDeleted={() => router.push("/skills")} />
      )}
      <div style={s.page}>
        <Link href="/skills" style={s.back}>
          {t("detail.back")}
        </Link>

        {isLoading && (
          <div style={s.loading} aria-busy="true">
            <Skeleton height={28} width={280} />
            <Skeleton height={240} />
          </div>
        )}
        {notFound && (
          <EmptyState icon="Sparkles" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
        )}
        {failed && !notFound && <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />}

        {skill && (
          <>
            <div style={s.header}>
              <span style={s.iconBox(TYPE_COLOR[skill.type].c, TYPE_COLOR[skill.type].bg)}>
                <Icon.Sparkles size={15} />
              </span>
              <h1 className="mono" style={s.h1}>
                {skill.name}
              </h1>
              <span style={s.typeChip(TYPE_COLOR[skill.type].c, TYPE_COLOR[skill.type].bg)}>
                {t(`listItem.type.${skill.type}`)}
              </span>
              <Badge color="var(--text-secondary)" icon="GitCommit">
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
            </div>
            <div style={s.tabs}>
              <Tabs
                tabs={TABS.map((tb) => ({ key: tb.key, label: t(`detail.tabs.${tb.key}`), icon: tb.icon }))}
                value={tab}
                onChange={setTab}
                pad="0"
              />
            </div>
            <div style={s.body}>
              {/* Keyed by version: after a save or a restore the form starts from the new state. */}
              {tab === "config" && (
                <ConfigTab key={`${skill.id}:${skill.version}`} skill={skill} onDelete={() => setDeleting(true)} />
              )}
              {tab === "preview" && <PreviewTab skill={skill} />}
              {tab === "versioning" && <VersioningTab skill={skill} />}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
