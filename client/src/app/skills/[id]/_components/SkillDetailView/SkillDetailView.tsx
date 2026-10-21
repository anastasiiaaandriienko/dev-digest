/* /skills/:id — Skill editor (HW2 #25; design: Skills Lab, list + editor). The
   list column (SkillsSidebar) stays on the left with this skill highlighted;
   the editor shows the header (type, name, version, status) and the Config /
   Preview / Evals / Stats / Versions tabs, kept in `?tab=` like the agent
   editor. Picking another card keeps the open tab; if Config has unsaved
   edits, UnsavedChangesModal asks first (Save and continue / Discard / Cancel).
   Config stays mounted while another tab is shown, so switching tabs keeps
   its edits; Restore is blocked while they are unsaved, and the Stats tab's
   agent links ask too. Known limit: the breadcrumb and the app navigation are
   not guarded, only a browser reload / close is (beforeunload). Deleting
   from the Config tab reuses DeleteSkillModal and returns to /skills. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton, Tabs } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { UnsavedChangesModal } from "@/components/unsaved-changes-modal";
import { ApiError } from "@/lib/api";
import { useSkill } from "@/lib/hooks/skills";
import { TYPE_COLOR } from "../../../constants";
import { DeleteSkillModal } from "../../../_components/DeleteSkillModal";
import { SkillsSidebar } from "../../../_components/SkillsSidebar";
import { ConfigTab, type ConfigGuard } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { EvalsTab } from "./_components/EvalsTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
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
  const configGuard = React.useRef<ConfigGuard | null>(null);
  /** Where the user wanted to go while Config had unsaved edits (the dialog is open). */
  const [leaving, setLeaving] = React.useState<string | null>(null);
  const [savingToLeave, setSavingToLeave] = React.useState(false);
  /** Config has unsaved edits (Restore is blocked meanwhile: it would replace the form). */
  const [configDirty, setConfigDirty] = React.useState(false);

  const requested = search.get("tab");
  const tab: SkillTab["key"] = TABS.some((tb) => tb.key === requested) ? (requested as SkillTab["key"]) : DEFAULT_TAB;
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`, { scroll: false });
  };

  /** Leave this skill for `url` — via UnsavedChangesModal when Config has unsaved edits. */
  const leaveTo = (url: string) => {
    if (configGuard.current?.dirty) setLeaving(url);
    else router.push(url);
  };
  const openSkill = (next: string) => {
    if (next !== id) leaveTo(`/skills/${next}?tab=${tab}`);
  };
  const saveAndLeave = async () => {
    if (!leaving) return;
    setSavingToLeave(true);
    const saved = (await configGuard.current?.save()) ?? true;
    setSavingToLeave(false);
    // A failed save stays here with the edits (and its errors / toast) visible.
    if (saved) router.push(leaving);
    else if (tab !== "config") setTab("config");
    setLeaving(null);
  };
  const discardAndLeave = () => {
    if (!leaving) return;
    router.push(leaving);
    setLeaving(null);
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
      {leaving && skill && (
        <UnsavedChangesModal
          name={skill.name}
          saving={savingToLeave}
          onSave={saveAndLeave}
          onDiscard={discardAndLeave}
          onCancel={() => setLeaving(null)}
        />
      )}
      <div className="dd-skills-lab" style={s.lab}>
        <SkillsSidebar selectedId={id} onSelect={openSkill} />

        <section style={s.editor} aria-label={skill?.name ?? t("detail.crumbSkill")}>
          {isLoading && (
            <div style={s.state} aria-busy="true">
              <Skeleton height={26} width={280} />
              <Skeleton height={240} />
            </div>
          )}
          {notFound && (
            <div style={s.state}>
              <EmptyState icon="Sparkles" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
            </div>
          )}
          {failed && !notFound && (
            <div style={s.state}>
              <ErrorState body={t("detail.loadError")} onRetry={() => refetch()} />
            </div>
          )}

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
                  tabs={TABS.map((tb) => ({ key: tb.key, label: t(`detail.tabs.${tb.key}`) }))}
                  value={tab}
                  onChange={setTab}
                  pad="0 24px"
                />
              </div>
              <div className="dd-skills-lab-editor-scroll" style={s.body}>
                {/* Keyed by version: after a save or a restore the form starts from the new state.
                    Always mounted (hidden on other tabs) so its unsaved edits survive a tab switch. */}
                <div hidden={tab !== "config"}>
                  <ConfigTab
                    key={`${skill.id}:${skill.version}`}
                    skill={skill}
                    onDelete={() => setDeleting(true)}
                    guardRef={configGuard}
                    onDirtyChange={setConfigDirty}
                  />
                </div>
                {tab === "preview" && <PreviewTab skill={skill} />}
                {tab === "evals" && <EvalsTab />}
                {tab === "stats" && <StatsTab skill={skill} onNavigate={leaveTo} />}
                {tab === "context" && <ContextTab skill={skill} />}
                {tab === "versioning" && <VersioningTab skill={skill} restoreBlocked={configDirty} />}
              </div>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}
