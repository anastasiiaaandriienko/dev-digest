/* SkillsSidebar — the Skills Lab list column (design: Skills Lab, left of the
   editor): "Skills" heading, the "Add Skill" menu (import from a .md / .zip
   file — HW2 #15 — or create from scratch), search, and the scrollable skill
   cards with their enabled toggles. Shared by /skills and /skills/:id; the
   create and import modals live here so both pages offer them. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportSkillModal } from "../ImportSkillModal";
import { SkillCard } from "../SkillCard";
import { SKELETON_CARDS } from "./constants";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsSidebar({
  selectedId,
  onSelect,
}: {
  /** The skill open in the editor (highlighted card). */
  selectedId?: string | null;
  /** Open a skill (also called with the first skill a create / import produced). */
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const list = filterSkills(skills ?? [], query);
  // A failed BACKGROUND refetch keeps the cached list (React Query leaves `data`): no error screen then.
  const failed = isError && !skills;

  return (
    <aside className="dd-skills-lab-list" style={s.column} aria-label={t("page.heading")}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={(sk) => onSelect(sk.id)} />}
      {importing && (
        <ImportSkillModal onClose={() => setImporting(false)} onImported={(created) => created[0] && onSelect(created[0].id)} />
      )}
      <div style={s.head}>
        <div style={s.titleRow}>
          <h2 style={s.h2}>{t("page.heading")}</h2>
          <Dropdown
            width={240}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.fromFile"), icon: "Upload", hint: t("page.menu.fromFileHint"), onClick: () => setImporting(true) },
              { divider: true },
              { label: t("page.menu.createFromScratch"), icon: "Edit", onClick: () => setCreating(true) },
            ]}
          />
        </div>
        <label className="dd-skills-lab-search" style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("page.searchPlaceholder")}
            aria-label={t("page.searchPlaceholder")}
            style={s.searchInput}
          />
        </label>
      </div>

      <div style={s.scroll}>
        {isLoading && (
          <div style={s.stack} aria-busy="true">
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <Skeleton key={i} height={104} />
            ))}
          </div>
        )}
        {failed && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && skills && skills.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setCreating(true)}
          />
        )}
        {!isLoading && (skills?.length ?? 0) > 0 && list.length === 0 && (
          <EmptyState icon="Search" title={t("page.noMatch.title")} body={t("page.noMatch.body", { query })} />
        )}
        {list.length > 0 && (
          <div style={s.stack} data-testid="skills-list">
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                onOpen={() => onSelect(sk.id)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
